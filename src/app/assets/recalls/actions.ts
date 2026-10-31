"use server";
/**
 * Recall / FSCA actions. A notice is not tied to one hospital (it comes from the manufacturer or regulator); the devices
 * it hits are, so jobs and per-device decisions are limited to the user's hospitals.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, recallAssets, recalls, workOrders } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, id, isoDate, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { criteriaProblem, matchRecall, parseSerials, RECALL_ACTIONS, RECALL_ASSET_STATUSES, recallProgress } from "@/lib/assets/recalls";
import { applyAssetEffect, notifyAssigners } from "@/lib/assets/work-order-server";
import { responseDue } from "@/lib/assets/work-orders";
import { notifyRole } from "@/lib/notifications";
import { logActivity, nextNumber } from "@/lib/server-utils";

const path = (rid: number) => `/assets/recalls/${rid}`;
const go = (rid: number, msg: string): never => redirect(`${path(rid)}?notice=${encodeURIComponent(msg)}`);
const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const RecallSchema = z.object({
  title: reqText("Title", 200), reference: text(120), source: text(80), description: text(6000), manufacturer: text(120), deviceTypeId: id(),
  modelPattern: text(120), serials: text(100000), action: oneOf("Required action", RECALL_ACTIONS), urgent: flag,
  issuedDate: isoDate("Issued date"), dueDate: isoDate("Due date"),
});

async function candidates() {
  return db.select({ id: assets.id, deviceTypeId: assets.deviceTypeId, manufacturer: assets.manufacturer, model: assets.model,
    serialNumber: assets.serialNumber, status: assets.status, facilityId: assets.facilityId }).from(assets).where(sql`${assets.status} <> 'DISPOSED'`);
}

export async function createRecallAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const p = RecallSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const serialNumbers = parseSerials(d.serials);
  const criteria = { deviceTypeId: d.deviceTypeId ?? null, manufacturer: d.manufacturer ?? null, modelPattern: d.modelPattern ?? null, serialNumbers };
  const problem = criteriaProblem(criteria);
  if (problem) return { error: problem };
  if (d.dueDate && d.issuedDate && d.dueDate < d.issuedDate) return { error: "The due date is before the issue date." };
  const hits = matchRecall(criteria, await candidates()) as (Awaited<ReturnType<typeof candidates>>[number])[];
  const rec = await db.transaction(async (tx) => {
    const number = await nextNumber("FSCA", recalls, recalls.number, tx);
    const [row] = await tx.insert(recalls).values({
      number, title: d.title, reference: d.reference ?? null, source: d.source ?? null, description: d.description ?? null,
      manufacturer: d.manufacturer ?? null, deviceTypeId: d.deviceTypeId ?? null, modelPattern: d.modelPattern ?? null,
      serialNumbers: serialNumbers.length ? serialNumbers : null, action: d.action ?? "INSPECT", urgent: d.urgent,
      issuedDate: d.issuedDate ?? null, dueDate: d.dueDate ?? null,
    }).returning({ id: recalls.id, number: recalls.number });
    if (hits.length) await tx.insert(recallAssets).values(hits.map((a) => ({ recallId: row.id, assetId: a.id })));
    await logActivity("recall", row.id, "created", `${row.number} recorded: ${hits.length} matching device${hits.length === 1 ? "" : "s"}`, me.name, tx);
    for (const a of hits.slice(0, 2000)) await logActivity("asset", a.id, "recall", `Affected by recall ${row.number}: ${d.title}`.slice(0, 300), me.name, tx);
    return row;
  });
  // Tell each hospital's biomedical team how many of its devices are affected.
  const perFacility = new Map<number, number>();
  for (const a of hits) perFacility.set(a.facilityId, (perFacility.get(a.facilityId) ?? 0) + 1);
  for (const [facilityId, n] of perFacility) {
    await notifyRole("BIOMEDICAL", {
      kind: "recall_issued", title: `${d.urgent ? "Urgent recall" : "Recall"} ${rec.number}: ${n} of your devices affected`,
      body: d.title, href: path(rec.id), dedupeKey: `recall:${rec.id}:${facilityId}`,
    }, facilityId);
  }
  revalidatePath("/assets/recalls");
  return go(rec.id, hits.length ? `${rec.number} recorded. ${hits.length} device${hits.length === 1 ? " is" : "s are"} affected.` : `${rec.number} recorded. No registered device matches it.`);
}

async function loadRecall(rid: number) {
  const [r] = await db.select().from(recalls).where(eq(recalls.id, rid));
  return r;
}

/** Check the register again (devices added since the notice was recorded). */
export async function rematchRecallAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const rid = Number(fd.get("recallId"));
  const r = Number.isInteger(rid) ? await loadRecall(rid) : undefined;
  if (!r) return { error: "That recall no longer exists." };
  if (r.status === "CLOSED") return { error: "This recall is closed." };
  const hits = matchRecall(r, await candidates());
  const added = hits.length ? await db.insert(recallAssets).values(hits.map((a) => ({ recallId: r.id, assetId: a.id }))).onConflictDoNothing()
    .returning({ assetId: recallAssets.assetId }) : [];
  if (added.length) await logActivity("recall", r.id, "rematched", `${added.length} more device${added.length === 1 ? "" : "s"} found`, me.name);
  revalidatePath(path(r.id));
  return go(r.id, added.length ? `${added.length} more device${added.length === 1 ? "" : "s"} found.` : "No new devices match.");
}

/** Raise one job per pending device in the user's hospitals that has none yet. */
export async function createRecallJobsAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const rid = Number(fd.get("recallId"));
  const r = Number.isInteger(rid) ? await loadRecall(rid) : undefined;
  if (!r) return { error: "That recall no longer exists." };
  if (r.status === "CLOSED") return { error: "This recall is closed." };
  const scope = await facilityScope(me);
  const pending = await db.select({ assetId: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status })
    .from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(and(eq(recallAssets.recallId, r.id), eq(recallAssets.status, "PENDING"), isNull(recallAssets.workOrderId),
      sql`${assets.status} <> 'DISPOSED'`, scope === null ? undefined : scope.length ? inArray(assets.facilityId, scope) : sql`false`));
  if (!pending.length) return { error: "Every pending device already has a job." };
  if (pending.length > 1000) return { error: "That is more than 1,000 jobs at once. Ask for help to split the recall." };
  const down = r.action === "REMOVE_FROM_USE";
  const priority = r.urgent ? "URGENT" as const : "HIGH" as const;
  const now = new Date();
  const facilitiesHit = new Set<number>();
  await db.transaction(async (tx) => {
    for (const a of pending) {
      const number = await nextNumber("WO", workOrders, workOrders.number, tx);
      const [w] = await tx.insert(workOrders).values({
        number, assetId: a.assetId, facilityId: a.facilityId, type: "INSPECTION", priority, status: "OPEN",
        title: `Recall ${r.number}: ${r.title}`.slice(0, 160),
        description: [r.reference && `Manufacturer reference ${r.reference}.`, r.description].filter(Boolean).join("\n\n") || null,
        deviceDown: down, reportedById: me.id, reportedByName: me.name, reportedAt: now,
        dueAt: r.dueDate ? new Date(`${r.dueDate}T23:59:59Z`) : responseDue(now, priority), downtimeStart: down ? now : null,
      }).returning({ id: workOrders.id, number: workOrders.number, assetId: workOrders.assetId, deviceDown: workOrders.deviceDown });
      await tx.update(recallAssets).set({ workOrderId: w.id }).where(and(eq(recallAssets.recallId, r.id), eq(recallAssets.assetId, a.assetId)));
      await logActivity("work_order", w.id, "reported", `Raised for recall ${r.number}`, me.name, tx);
      if (down) await applyAssetEffect("report", w, { actor: me.name }, tx);
      facilitiesHit.add(a.facilityId);
    }
    await logActivity("recall", r.id, "jobs", `${pending.length} job${pending.length === 1 ? "" : "s"} raised`, me.name, tx);
  });
  for (const f of facilitiesHit) {
    await notifyAssigners(f, me.id, { kind: "work_order_reported", title: `${r.number}: recall jobs raised`, body: r.title, href: `/assets/work-orders?tab=unassigned&q=${encodeURIComponent(r.number)}`, dedupeKey: `recall_jobs:${r.id}:${f}:${now.getTime()}` });
  }
  revalidatePath(path(r.id));
  revalidatePath("/assets/work-orders");
  return go(r.id, `${pending.length} job${pending.length === 1 ? "" : "s"} raised. Assign them under Work orders.`);
}

const DeviceSchema = z.object({ recallId: reqId("Recall"), assetId: reqId("Device"), status: oneOf("Status", RECALL_ASSET_STATUSES), note: text(500) });

/** Record by hand that a device was dealt with or isn't affected (e.g. serial outside the batch). */
export async function setRecallDeviceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const p = DeviceSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const [row] = await db.select({ facilityId: assets.facilityId, tag: assets.assetTag }).from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(and(eq(recallAssets.recallId, p.data.recallId), eq(recallAssets.assetId, p.data.assetId)));
  if (!row) return { error: "That device isn't on this recall." };
  await requireFacilityAccess(row.facilityId, me);
  const status = p.data.status ?? "ACTIONED";
  if (status === "NOT_AFFECTED" && !p.data.note) return { error: "Say why the device isn't affected (for example: serial outside the batch)." };
  await db.update(recallAssets).set({ status, note: p.data.note ?? null, actionedAt: status === "PENDING" ? null : new Date() })
    .where(and(eq(recallAssets.recallId, p.data.recallId), eq(recallAssets.assetId, p.data.assetId)));
  await logActivity("recall", p.data.recallId, "device", `${row.tag} marked ${status.toLowerCase().replace("_", " ")}${p.data.note ? ` — ${p.data.note}` : ""}`, me.name);
  revalidatePath(path(p.data.recallId));
  return go(p.data.recallId, `${row.tag} updated.`);
}

export async function closeRecallAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("recalls.edit");
  const rid = Number(fd.get("recallId"));
  const r = Number.isInteger(rid) ? await loadRecall(rid) : undefined;
  if (!r) return { error: "That recall no longer exists." };
  const rows = await db.select({ status: recallAssets.status }).from(recallAssets).where(eq(recallAssets.recallId, r.id));
  const prog = recallProgress(rows);
  if (!prog.done) return { error: `${prog.pending} device${prog.pending === 1 ? " is" : "s are"} still pending. Deal with them first.` };
  await db.update(recalls).set({ status: "CLOSED", closedAt: new Date() }).where(eq(recalls.id, r.id));
  await logActivity("recall", r.id, "closed", `Closed: ${prog.actioned} actioned, ${prog.notAffected} not affected`, me.name);
  revalidatePath(path(r.id));
  revalidatePath("/assets/recalls");
  return go(r.id, "Recall closed.");
}

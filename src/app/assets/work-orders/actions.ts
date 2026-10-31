"use server";
/**
 * Work order actions. Every export here is a public endpoint: each one checks the permission first, then the facility,
 * then the pure rules in lib/assets/work-orders (who may do what in which status). Status changes use a
 * "where status = <what I saw>" guard so two people clicking at once can't both move the same job.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, maintenanceEvents, users, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { firstError, formObject, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { applyAssetEffect, assignableUsers, notifyAssigners } from "@/lib/assets/work-order-server";
import {
  actionProblem, downtimeHours, nextStatus, responseDue, suggestedPriority, WORK_ORDER_PRIORITIES, WORK_ORDER_TYPES,
  type WorkOrderAction, type WorkOrderPriority,
} from "@/lib/assets/work-orders";
import { notifyUsers } from "@/lib/notifications";
import { logActivity, nextNumber } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";

const actor = (me: CurrentUser) => ({ id: me.id, canAssign: can(me.role, "workorders.assign"), canWork: can(me.role, "maintenance.edit") });
const path = (id: number) => `/assets/work-orders/${id}`;
const done = (id: number, msg: string): never => redirect(`${path(id)}?notice=${encodeURIComponent(msg)}`);

function refresh(id: number, assetId: number) {
  revalidatePath(path(id));
  revalidatePath("/assets/work-orders");
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets/3d");
  revalidatePath("/assets/map");
}

/* ── Report a fault ── */

const ReportSchema = z.object({
  assetId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  assetTag: text(48),
  title: reqText("What is wrong", 160),
  description: text(4000),
  priority: oneOf("Priority", WORK_ORDER_PRIORITIES),
  type: oneOf("Job type", WORK_ORDER_TYPES),
  deviceDown: z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean()),
  reporterContact: text(120),
});

export async function reportFaultAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.report");
  const p = ReportSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.assetId && !d.assetTag) return { error: "Choose the device: scan its label or type its asset tag." };

  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality, typeName: deviceTypes.name })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(d.assetId ? eq(assets.id, d.assetId) : sql`upper(${assets.assetTag}) = ${d.assetTag!.toUpperCase()}`);
  if (!a) return { error: d.assetTag ? `No device has the tag ${d.assetTag.toUpperCase()}. Check the label and try again.` : "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: `${a.tag} has been disposed of — it can't get a work order.` };

  // Only maintenance staff pick a planned job type; a fault report is always corrective.
  const type = can(me.role, "maintenance.edit") ? d.type ?? "CORRECTIVE" : "CORRECTIVE";
  const priority: WorkOrderPriority = d.priority ?? suggestedPriority(a.criticality, d.deviceDown);
  const now = new Date();

  const wo = await db.transaction(async (tx) => {
    const number = await nextNumber("WO", workOrders, workOrders.number, tx);
    const [row] = await tx.insert(workOrders).values({
      number, assetId: a.id, facilityId: a.facilityId, type, priority, status: "OPEN",
      title: d.title, description: d.description ?? null, deviceDown: d.deviceDown,
      reportedById: me.id, reportedByName: me.name, reporterContact: d.reporterContact ?? null,
      reportedAt: now, dueAt: responseDue(now, priority), downtimeStart: d.deviceDown ? now : null,
    }).returning({ id: workOrders.id, number: workOrders.number, assetId: workOrders.assetId, deviceDown: workOrders.deviceDown });
    await logActivity("work_order", row.id, "reported", `Reported by ${me.name}: ${d.title}${d.deviceDown ? " (device out of use)" : ""}`, me.name, tx);
    await logActivity("asset", a.id, "work_order", `${row.number} reported — ${d.title}`, me.name, tx);
    await applyAssetEffect("report", row, { actor: me.name }, tx);
    return row;
  });

  await notifyAssigners(a.facilityId, me.id, {
    kind: "work_order_reported", title: `${wo.number}: ${humanize(priority).toLowerCase()} fault on ${a.tag} — ${d.title}`.slice(0, 200),
    body: `${a.typeName}. Reported by ${me.name}${d.deviceDown ? "; the device is out of use" : ""}.`, href: path(wo.id), dedupeKey: `wo_reported:${wo.id}`,
  });
  refresh(wo.id, a.id);
  return done(wo.id, `${wo.number} reported. The biomedical team has been told.`);
}

/* ── Load + guard ── */

async function loadForAction(woId: number, action: WorkOrderAction, me: CurrentUser) {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return { error: "That work order no longer exists." } as const;
  await requireFacilityAccess(wo.facilityId, me);
  const problem = actionProblem(wo, action, actor(me));
  if (problem) return { error: problem } as const;
  return { wo, next: nextStatus(wo.status, action)! } as const;
}

/**
 * Inside a transaction always pass the actor to logActivity: looking up the signed-in user would query outside the
 * transaction, which deadlocks on PGlite's single connection.
 */
/** Update only if nobody changed the status meanwhile. */
async function guardedUpdate(tx: Pick<typeof db, "update">, wo: { id: number; status: typeof workOrders.$inferSelect.status }, set: Partial<typeof workOrders.$inferInsert>) {
  const rows = await tx.update(workOrders).set(set).where(and(eq(workOrders.id, wo.id), eq(workOrders.status, wo.status))).returning({ id: workOrders.id });
  return rows.length === 1;
}
const RACE = "Someone else changed this job a moment ago. Reload the page to see its current state.";

/* ── Assign / reassign ── */

const AssignSchema = z.object({ workOrderId: reqId("Work order"), assigneeId: reqId("Person"), priority: oneOf("Priority", WORK_ORDER_PRIORITIES), note: text(500) });

export async function assignWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.assign");
  const p = AssignSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const r = await loadForAction(p.data.workOrderId, "assign", me);
  if ("error" in r) return { error: r.error };
  const { wo, next } = r;
  const candidates = await assignableUsers(wo.facilityId);
  const who = candidates.find((u) => u.id === p.data.assigneeId);
  if (!who) return { error: "That person can't take this job: they need maintenance rights and access to this hospital." };
  if (who.id === wo.assignedToId && (!p.data.priority || p.data.priority === wo.priority)) return { error: `${who.name} already has this job.` };
  const priority = p.data.priority ?? wo.priority;
  const ok = await db.transaction(async (tx) => {
    const set: Partial<typeof workOrders.$inferInsert> = { status: next, assignedToId: who.id, assignedAt: new Date(), priority };
    if (priority !== wo.priority && !wo.startedAt) set.dueAt = responseDue(wo.reportedAt, priority);
    if (!(await guardedUpdate(tx, wo, set))) return false;
    const verb = wo.assignedToId ? "Reassigned" : "Assigned";
    await logActivity("work_order", wo.id, "assigned",
      `${verb} to ${who.name}${priority !== wo.priority ? `, priority ${humanize(priority).toLowerCase()}` : ""}${p.data.note ? ` — ${p.data.note}` : ""}`, me.name, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  if (who.id !== me.id) {
    await notifyUsers([who.id], {
      kind: "work_order_assigned", title: `Job ${wo.number} assigned to you: ${wo.title}`.slice(0, 200),
      body: `${humanize(priority)} priority. Assigned by ${me.name}.${p.data.note ? ` ${p.data.note}` : ""}`, href: path(wo.id),
      dedupeKey: `wo_assigned:${wo.id}:${who.id}:${Date.now()}`,
    });
  }
  refresh(wo.id, wo.assetId);
  return done(wo.id, `Assigned to ${who.name}.`);
}

/* ── Start / hold / resume ── */

const ProgressSchema = z.object({ workOrderId: reqId("Work order"), step: z.enum(["start", "hold", "resume"]), holdReason: text(500) });

export async function progressWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = ProgressSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { step, holdReason } = p.data;
  if (step === "hold" && !holdReason) return { error: "Say why the job is on hold (for example: waiting for a spare part)." };
  const r = await loadForAction(p.data.workOrderId, step, me);
  if ("error" in r) return { error: r.error };
  const { wo, next } = r;
  const ok = await db.transaction(async (tx) => {
    const set: Partial<typeof workOrders.$inferInsert> = { status: next };
    if (step === "start") { set.startedAt = new Date(); if (!wo.assignedToId) { set.assignedToId = me.id; set.assignedAt = new Date(); } }
    if (step === "hold") set.holdReason = holdReason!;
    if (step === "resume") set.holdReason = null;
    if (!(await guardedUpdate(tx, wo, set))) return false;
    await logActivity("work_order", wo.id, step === "start" ? "started" : step === "hold" ? "on_hold" : "resumed",
      step === "start" ? `Work started by ${me.name}` : step === "hold" ? `On hold — ${holdReason}` : "Work resumed", me.name, tx);
    if (step === "start") await applyAssetEffect("start", wo, { actor: me.name }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  refresh(wo.id, wo.assetId);
  return done(wo.id, step === "start" ? "Work started." : step === "hold" ? "Job put on hold." : "Work resumed.");
}

/* ── Complete ── */

const CompleteSchema = z.object({
  workOrderId: reqId("Work order"), resolution: reqText("What was done", 4000), rootCause: text(500),
  laborHours: num("Labour hours", 0, 1000), cost: num("Cost", 0, 1e10), currency: text(3),
  returnToService: z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean()),
});

export async function completeWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = CompleteSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const r = await loadForAction(d.workOrderId, "complete", me);
  if ("error" in r) return { error: r.error };
  const { wo, next } = r;
  const now = new Date();
  const [assignee] = wo.assignedToId ? await db.select({ name: users.name }).from(users).where(eq(users.id, wo.assignedToId)) : [];
  const currency = d.cost != null ? (d.currency ?? "EGP").toUpperCase() : null;
  const ok = await db.transaction(async (tx) => {
    const downtimeEnd = wo.deviceDown && d.returnToService ? now : wo.downtimeEnd;
    if (!(await guardedUpdate(tx, wo, {
      status: next, completedAt: now, startedAt: wo.startedAt ?? now, resolution: d.resolution, rootCause: d.rootCause ?? null,
      laborHours: d.laborHours ?? null, cost: d.cost != null ? String(d.cost) : null, currency, downtimeEnd,
    }))) return false;
    // The maintenance history (and PPM due dates) read from maintenance_events, so every finished job writes one.
    const [ev] = await tx.insert(maintenanceEvents).values({
      assetId: wo.assetId, type: wo.type, status: "COMPLETED", scheduledDate: todayISO(wo.reportedAt), completedDate: todayISO(now),
      performedBy: assignee?.name ?? me.name, cost: d.cost != null ? String(d.cost) : null, currency,
      downtimeHours: wo.deviceDown ? Math.round(downtimeHours({ downtimeStart: wo.downtimeStart, downtimeEnd: downtimeEnd ?? now }, now) * 10) / 10 : null,
      findings: `${wo.number}: ${d.resolution}`.slice(0, 4000),
    }).returning({ id: maintenanceEvents.id });
    await tx.update(workOrders).set({ maintenanceEventId: ev.id }).where(eq(workOrders.id, wo.id));
    await logActivity("work_order", wo.id, "completed", `Completed by ${me.name}: ${d.resolution.slice(0, 200)}${wo.deviceDown ? (d.returnToService ? " — back in service" : " — still out of use") : ""}`, me.name, tx);
    await logActivity("asset", wo.assetId, "maintenance", `${wo.number} completed — ${d.resolution.slice(0, 120)}`, me.name, tx);
    await applyAssetEffect("complete", wo, { returnToService: d.returnToService, actor: me.name }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  if (wo.reportedById && wo.reportedById !== me.id) {
    await notifyUsers([wo.reportedById], {
      kind: "work_order_completed", title: `${wo.number} is fixed: ${wo.title}`.slice(0, 200),
      body: d.returnToService || !wo.deviceDown ? "The device is back in service." : "The job is done but the device is still out of use.", href: path(wo.id),
      dedupeKey: `wo_completed:${wo.id}:${now.getTime()}`,
    });
  }
  refresh(wo.id, wo.assetId);
  revalidatePath("/assets/maintenance");
  return done(wo.id, "Job completed and added to the maintenance history.");
}

/* ── Close (sign-off) / reopen / cancel ── */

const DecideSchema = z.object({ workOrderId: reqId("Work order"), step: z.enum(["close", "reopen"]), note: text(500) });

export async function signOffWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.assign");
  const p = DecideSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const { step, note } = p.data;
  if (step === "reopen" && !note) return { error: "Say why the job is being reopened." };
  const r = await loadForAction(p.data.workOrderId, step, me);
  if ("error" in r) return { error: r.error };
  const { wo, next } = r;
  const now = new Date();
  const ok = await db.transaction(async (tx) => {
    const set: Partial<typeof workOrders.$inferInsert> = step === "close"
      ? { status: next, closedAt: now, downtimeEnd: wo.deviceDown ? wo.downtimeEnd ?? now : wo.downtimeEnd }
      : { status: next, completedAt: null, maintenanceEventId: null, downtimeEnd: wo.deviceDown ? null : wo.downtimeEnd };
    if (!(await guardedUpdate(tx, wo, set))) return false;
    // A reopened job is not finished: take its entry out of the maintenance history until it is completed again.
    if (step === "reopen" && wo.maintenanceEventId) await tx.delete(maintenanceEvents).where(eq(maintenanceEvents.id, wo.maintenanceEventId));
    await logActivity("work_order", wo.id, step === "close" ? "closed" : "reopened",
      step === "close" ? `Signed off by ${me.name}${note ? ` — ${note}` : ""}` : `Reopened by ${me.name} — ${note}`, me.name, tx);
    if (step === "reopen") await applyAssetEffect("start", wo, { actor: me.name }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  if (step === "reopen" && wo.assignedToId && wo.assignedToId !== me.id) {
    await notifyUsers([wo.assignedToId], { kind: "work_order_assigned", title: `${wo.number} reopened: ${wo.title}`.slice(0, 200), body: note, href: path(wo.id),
      dedupeKey: `wo_reopened:${wo.id}:${now.getTime()}` });
  }
  refresh(wo.id, wo.assetId);
  revalidatePath("/assets/maintenance");
  return done(wo.id, step === "close" ? "Job signed off and closed." : "Job reopened.");
}

const CancelSchema = z.object({ workOrderId: reqId("Work order"), reason: reqText("Reason", 500) });

export async function cancelWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  // Reporters may withdraw their own untouched report, so the base permission is reporting; the rules decide the rest.
  const me = await requirePermission("workorders.report");
  const p = CancelSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const r = await loadForAction(p.data.workOrderId, "cancel", me);
  if ("error" in r) return { error: r.error };
  const { wo, next } = r;
  const now = new Date();
  const ok = await db.transaction(async (tx) => {
    if (!(await guardedUpdate(tx, wo, { status: next, closedAt: now, downtimeEnd: wo.deviceDown ? wo.downtimeEnd ?? now : wo.downtimeEnd }))) return false;
    await logActivity("work_order", wo.id, "cancelled", `Cancelled by ${me.name} — ${p.data.reason}`, me.name, tx);
    await applyAssetEffect("cancel", wo, { actor: me.name }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  if (wo.assignedToId && wo.assignedToId !== me.id) {
    await notifyUsers([wo.assignedToId], { kind: "work_order_assigned", title: `${wo.number} cancelled: ${wo.title}`.slice(0, 200), body: p.data.reason, href: path(wo.id),
      dedupeKey: `wo_cancelled:${wo.id}` });
  }
  refresh(wo.id, wo.assetId);
  return done(wo.id, "Work order cancelled.");
}

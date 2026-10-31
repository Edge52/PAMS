"use server";
/**
 * Work order actions. Every export here is a public endpoint: each one checks the permission first, then the facility,
 * then the pure rules in lib/assets/work-orders (who may do what in which status). Status changes use a
 * "where status = <what I saw>" guard so two people clicking at once can't both move the same job.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, maintenanceEvents, recallAssets, users, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { firstError, formObject, isoDate, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { applyAssetEffect, assignableUsers, checklistForType, coverForAsset, notifyAssigners } from "@/lib/assets/work-order-server";
import { blankResults, CHECKLIST_TYPES, checklistSummary, fillChecklist, type Answer } from "@/lib/assets/checklists";
import { CLAIM_STATUSES } from "@/lib/assets/contracts";
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

  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality,
    typeName: deviceTypes.name, deviceTypeId: assets.deviceTypeId })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(d.assetId ? eq(assets.id, d.assetId) : sql`upper(${assets.assetTag}) = ${d.assetTag!.toUpperCase()}`);
  if (!a) return { error: d.assetTag ? `No device has the tag ${d.assetTag.toUpperCase()}. Check the label and try again.` : "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: `${a.tag} has been disposed of — it can't get a work order.` };

  // Only maintenance staff pick a planned job type; a fault report is always corrective.
  const type = can(me.role, "maintenance.edit") ? d.type ?? "CORRECTIVE" : "CORRECTIVE";
  const priority: WorkOrderPriority = d.priority ?? suggestedPriority(a.criticality, d.deviceDown);
  const now = new Date();
  const cover = await coverForAsset(a.id, todayISO(now));
  const checklist = CHECKLIST_TYPES.has(type) ? blankResults((await checklistForType(a.deviceTypeId)).items) : null;

  const wo = await db.transaction(async (tx) => {
    const number = await nextNumber("WO", workOrders, workOrders.number, tx);
    const [row] = await tx.insert(workOrders).values({
      number, assetId: a.id, facilityId: a.facilityId, type, priority, status: "OPEN",
      title: d.title, description: d.description ?? null, deviceDown: d.deviceDown,
      reportedById: me.id, reportedByName: me.name, reporterContact: d.reporterContact ?? null,
      reportedAt: now, dueAt: responseDue(now, priority), downtimeStart: d.deviceDown ? now : null,
      checklist, coverage: cover.kind, contractId: cover.kind === "CONTRACT" ? cover.contract.id : null,
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
  workOrderId: reqId("Work order"), resolution: text(4000), rootCause: text(500),
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
  // Checklist answers arrive as ck_result_<i>, ck_value_<i>, ck_note_<i>.
  let checklist = wo.checklist;
  let failed = 0;
  if (wo.checklist?.length) {
    const answers: Answer[] = wo.checklist.map((_, i) => ({
      result: fd.get(`ck_result_${i}`)?.toString() ?? null, value: fd.get(`ck_value_${i}`)?.toString() ?? null, note: fd.get(`ck_note_${i}`)?.toString() ?? null,
    }));
    const filled = fillChecklist(wo.checklist, answers);
    if (filled.problems.length) return { error: `Finish the checklist first. ${filled.problems.join(" ")}` };
    checklist = filled.results;
    failed = filled.failed;
  }
  const sum = checklistSummary(checklist);
  const resolution = d.resolution ?? (checklist?.length ? `Checklist done: ${sum.pass} passed, ${sum.fail} failed${sum.na ? `, ${sum.na} not applicable` : ""}.` : undefined);
  if (!resolution) return { error: "Say what was done." };
  const now = new Date();
  const [assignee] = wo.assignedToId ? await db.select({ name: users.name }).from(users).where(eq(users.id, wo.assignedToId)) : [];
  const currency = d.cost != null ? (d.currency ?? "EGP").toUpperCase() : null;
  const ok = await db.transaction(async (tx) => {
    const downtimeEnd = wo.deviceDown && d.returnToService ? now : wo.downtimeEnd;
    if (!(await guardedUpdate(tx, wo, {
      status: next, completedAt: now, startedAt: wo.startedAt ?? now, resolution, rootCause: d.rootCause ?? null,
      laborHours: d.laborHours ?? null, cost: d.cost != null ? String(d.cost) : null, currency, downtimeEnd, checklist,
    }))) return false;
    // The maintenance history (and PPM due dates) read from maintenance_events, so every finished job writes one —
    // or completes the scheduled visit it was raised for.
    const event = {
      status: "COMPLETED" as const, completedDate: todayISO(now), performedBy: assignee?.name ?? me.name, cost: d.cost != null ? String(d.cost) : null, currency,
      downtimeHours: wo.deviceDown ? Math.round(downtimeHours({ downtimeStart: wo.downtimeStart, downtimeEnd: downtimeEnd ?? now }, now) * 10) / 10 : null,
      findings: `${wo.number}: ${resolution}${failed ? ` (${failed} checklist item${failed === 1 ? "" : "s"} failed)` : ""}`.slice(0, 4000),
    };
    let eventId = wo.plannedEventId;
    if (eventId) await tx.update(maintenanceEvents).set(event).where(eq(maintenanceEvents.id, eventId));
    else eventId = (await tx.insert(maintenanceEvents).values({ ...event, assetId: wo.assetId, type: wo.type, scheduledDate: todayISO(wo.reportedAt) })
      .returning({ id: maintenanceEvents.id }))[0].id;
    await tx.update(workOrders).set({ maintenanceEventId: eventId }).where(eq(workOrders.id, wo.id));
    // A recall job done = that device is actioned for the recall.
    await tx.update(recallAssets).set({ status: "ACTIONED", actionedAt: now, note: `Done under ${wo.number}` })
      .where(and(eq(recallAssets.workOrderId, wo.id), eq(recallAssets.status, "PENDING")));
    await logActivity("work_order", wo.id, "completed", `Completed by ${me.name}: ${resolution.slice(0, 200)}${failed ? ` — ${failed} checklist item${failed === 1 ? "" : "s"} failed` : ""}${wo.deviceDown ? (d.returnToService ? " — back in service" : " — still out of use") : ""}`, me.name, tx);
    await logActivity("asset", wo.assetId, "maintenance", `${wo.number} completed — ${resolution.slice(0, 120)}`, me.name, tx);
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
    // A reopened job is not finished: take its entry out of the maintenance history until it is completed again
    // (a scheduled PPM visit goes back to scheduled rather than disappearing).
    if (step === "reopen" && wo.maintenanceEventId) {
      if (wo.maintenanceEventId === wo.plannedEventId) {
        await tx.update(maintenanceEvents).set({ status: "SCHEDULED", completedDate: null }).where(eq(maintenanceEvents.id, wo.maintenanceEventId));
      } else await tx.delete(maintenanceEvents).where(eq(maintenanceEvents.id, wo.maintenanceEventId));
    }
    await logActivity("work_order", wo.id, step === "close" ? "closed" : "reopened",
      step === "close" ? `Signed off by ${me.name}${note ? ` — ${note}` : ""}` : `Reopened by ${me.name} — ${note}`, me.name, tx);
    if (step === "reopen") {
      await applyAssetEffect("start", wo, { actor: me.name }, tx);
      await tx.update(recallAssets).set({ status: "PENDING", actionedAt: null }).where(and(eq(recallAssets.workOrderId, wo.id), eq(recallAssets.status, "ACTIONED")));
    }
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
    // A cancelled PPM job lets go of its scheduled visit, so a new job can be raised for it.
    if (!(await guardedUpdate(tx, wo, { status: next, closedAt: now, downtimeEnd: wo.deviceDown ? wo.downtimeEnd ?? now : wo.downtimeEnd, plannedEventId: null }))) return false;
    await logActivity("work_order", wo.id, "cancelled", `Cancelled by ${me.name} — ${p.data.reason}`, me.name, tx);
    // A cancelled recall job lets go of the device, so a new job can be raised for it.
    await tx.update(recallAssets).set({ workOrderId: null }).where(and(eq(recallAssets.workOrderId, wo.id), eq(recallAssets.status, "PENDING")));
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

/* ── PPM jobs from the maintenance schedule ── */

const PpmSchema = z.object({
  eventIds: text(20000), from: isoDate("From"), to: isoDate("To"), assigneeId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  departmentId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()), returnPath: text(300),
});
const MAX_PPM_JOBS = 500;

/**
 * Turn scheduled maintenance visits into work orders with the device type's checklist. Either the listed event ids
 * (one row's button) or every open scheduled visit between from and to. Visits that already have a job are skipped.
 */
export async function createPpmWorkOrdersAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = PpmSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const ids = (d.eventIds ?? "").split(",").map(Number).filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length && (!d.from || !d.to || d.from > d.to)) return { error: "Choose the visits: a from date before the to date." };
  const canAssign = can(me.role, "workorders.assign");
  if (d.assigneeId && !canAssign && d.assigneeId !== me.id) return { error: "Only the biomedical lead can give jobs to someone else." };

  const scope = await facilityScope(me);
  const rows = await db.select({
    id: maintenanceEvents.id, type: maintenanceEvents.type, scheduledDate: maintenanceEvents.scheduledDate, assetId: assets.id, tag: assets.assetTag,
    facilityId: assets.facilityId, deviceTypeId: assets.deviceTypeId, typeName: deviceTypes.name, assetStatus: assets.status,
  }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(workOrders, eq(workOrders.plannedEventId, maintenanceEvents.id))
    .where(and(
      inArray(maintenanceEvents.status, ["SCHEDULED", "OVERDUE"]), isNull(workOrders.id), sql`${assets.status} <> 'DISPOSED'`,
      ids.length ? inArray(maintenanceEvents.id, ids) : sql`${maintenanceEvents.scheduledDate} between ${d.from} and ${d.to}`,
      d.departmentId ? eq(assets.departmentId, d.departmentId) : undefined,
      scope === null ? undefined : scope.length ? inArray(assets.facilityId, scope) : sql`false`,
    )).orderBy(maintenanceEvents.scheduledDate).limit(MAX_PPM_JOBS + 1);
  if (!rows.length) return { error: ids.length ? "That visit already has a work order, or it is no longer scheduled." : "No scheduled visits without a work order in that window." };
  if (rows.length > MAX_PPM_JOBS) return { error: `That is more than ${MAX_PPM_JOBS} visits. Choose a shorter window or one department.` };

  let assignee: { id: number; name: string } | undefined;
  if (d.assigneeId) {
    for (const f of new Set(rows.map((r) => r.facilityId))) {
      const ok = (await assignableUsers(f)).find((u) => u.id === d.assigneeId);
      if (!ok) return { error: "That person can't take these jobs: they need maintenance rights and access to every hospital involved." };
      assignee = ok;
    }
  }
  const checklists = new Map<number, Awaited<ReturnType<typeof checklistForType>>>();
  for (const t of new Set(rows.map((r) => r.deviceTypeId))) checklists.set(t, await checklistForType(t));
  const covers = new Map<number, Awaited<ReturnType<typeof coverForAsset>>>();
  for (const r of rows) covers.set(r.assetId, await coverForAsset(r.assetId, r.scheduledDate ?? todayISO()));

  const now = new Date();
  const created = await db.transaction(async (tx) => {
    const out: { id: number; number: string }[] = [];
    for (const r of rows) {
      const number = await nextNumber("WO", workOrders, workOrders.number, tx);
      const cover = covers.get(r.assetId)!;
      const label = r.type === "PPM" ? "Planned preventive maintenance" : humanize(r.type);
      const [w] = await tx.insert(workOrders).values({
        number, assetId: r.assetId, facilityId: r.facilityId, type: r.type, priority: "NORMAL", status: assignee ? "ASSIGNED" : "OPEN",
        title: `${label} — ${r.typeName}`.slice(0, 160), reportedById: me.id, reportedByName: me.name, reportedAt: now,
        dueAt: r.scheduledDate ? new Date(`${r.scheduledDate}T23:59:59Z`) : responseDue(now, "NORMAL"),
        assignedToId: assignee?.id ?? null, assignedAt: assignee ? now : null, plannedEventId: r.id,
        checklist: blankResults(checklists.get(r.deviceTypeId)!.items),
        coverage: cover.kind, contractId: cover.kind === "CONTRACT" ? cover.contract.id : null,
      }).returning({ id: workOrders.id, number: workOrders.number });
      await logActivity("work_order", w.id, "reported", `Raised from the maintenance schedule (visit due ${r.scheduledDate})${assignee ? `, assigned to ${assignee.name}` : ""}`, me.name, tx);
      out.push(w);
    }
    return out;
  });
  if (assignee && assignee.id !== me.id) {
    await notifyUsers([assignee.id], {
      kind: "work_order_assigned", title: created.length === 1 ? `Job ${created[0].number} assigned to you: ${rows[0].tag} maintenance` : `${created.length} maintenance jobs assigned to you`,
      body: `Assigned by ${me.name}.`, href: created.length === 1 ? path(created[0].id) : "/assets/work-orders?tab=mine",
      dedupeKey: `wo_ppm:${created[0].id}:${created.length}`,
    });
  }
  revalidatePath("/assets/maintenance");
  revalidatePath("/assets/work-orders");
  if (created.length === 1) return done(created[0].id, `${created[0].number} created from the schedule.`);
  return { ok: `${created.length} work orders created${assignee ? ` and assigned to ${assignee.name}` : ""}. They are under Work orders.` };
}

/* ── Warranty / contract claim ── */

const ClaimSchema = z.object({ workOrderId: reqId("Work order"), claimStatus: oneOf("Claim status", CLAIM_STATUSES), claimReference: text(120) });

export async function updateClaimAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = ClaimSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, p.data.workOrderId));
  if (!wo) return { error: "That work order no longer exists." };
  await requireFacilityAccess(wo.facilityId, me);
  if (wo.coverage === "NONE") return { error: "This job has no warranty or contract to claim against." };
  const status = p.data.claimStatus ?? wo.claimStatus;
  if (status !== "NOT_CLAIMED" && !p.data.claimReference && !wo.claimReference) return { error: "Enter the supplier's claim or ticket reference." };
  await db.update(workOrders).set({ claimStatus: status, claimReference: p.data.claimReference ?? wo.claimReference }).where(eq(workOrders.id, wo.id));
  await logActivity("work_order", wo.id, "claim", `${wo.coverage === "WARRANTY" ? "Warranty" : "Contract"} claim ${humanize(status).toLowerCase()}${p.data.claimReference ? ` (ref. ${p.data.claimReference})` : ""}`, me.name);
  refresh(wo.id, wo.assetId);
  return done(wo.id, "Claim updated.");
}

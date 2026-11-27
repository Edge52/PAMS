import "server-only";
/**
 * The steps of working a job, shared by the work order page's actions and the offline sync on My jobs (wave 39), so
 * a job completed from a phone that was offline goes through exactly the same checks and writes. Each returns a
 * result; the callers redirect or report it. Callers check the permission first.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { maintenanceEvents, recallAssets, safetyTestWaivers, spareParts, users, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, type CurrentUser } from "@/lib/auth/session";
import { firstError, formObject, int, num, reqId, text } from "./forms";
import { calibrationHeld } from "./calibration-server";
import { applyAssetEffect } from "./work-order-server";
import { checklistSummary, fillChecklist, type Answer } from "./checklists";
import { actionProblem, downtimeHours, isActive, nextStatus, type WorkOrderAction } from "./work-orders";
import { completedLabour } from "./offline-jobs";
import { failureCodeLabel, failureCodeProblem, isFailureCode } from "./failure-codes";
import { applyMovement, issuedToJob, notifyIfLow } from "./parts-server";
import { notifyUsers } from "@/lib/notifications";
import { checkInstruments, saveInstruments } from "./test-equipment-server";
import { readingAtVisit } from "./meters-server";
import { quarantineFor, safetyGate } from "./vigilance-server";
import { quarantineBlock } from "./vigilance";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/**
 * Runs first inside the step's transaction, before its writes: the offline sync claims the change's key there. Throw
 * `AlreadyApplied` to roll the step back (another sync of the same change got there first).
 */
export type InTx = (tx: Tx) => Promise<void>;
export class AlreadyApplied extends Error { constructor() { super("already applied"); } }

/** Thrown inside a step's transaction to undo it (the claim included) and return `value` from `txn`. */
class Rollback<T> extends Error { constructor(public value: T) { super("rollback"); } }
async function txn<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try { return await db.transaction(fn); } catch (e) { if (e instanceof Rollback) return e.value as T; throw e; }
}
export type StepResult = { ok: true } | { error: string; fields?: Record<string, string> };

export const actor = (me: CurrentUser) => ({ id: me.id, canAssign: can(me.role, "workorders.assign"), canWork: can(me.role, "maintenance.edit") });
export const woPath = (id: number) => `/assets/work-orders/${id}`;
export const RACE = "Someone else changed this job a moment ago. Reload the page to see its current state.";

export function refreshJob(id: number, assetId: number) {
  revalidatePath(woPath(id));
  revalidatePath("/assets/work-orders");
  revalidatePath("/assets/my-jobs");
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets/3d");
  revalidatePath("/assets/map");
}

type WorkOrderRow = typeof workOrders.$inferSelect;
type Loaded = { wo: WorkOrderRow; next: WorkOrderRow["status"]; error?: undefined } | { error: string; wo?: undefined };

export async function loadForAction(woId: number, action: WorkOrderAction, me: CurrentUser): Promise<Loaded> {
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return { error: "That work order no longer exists." };
  await requireFacilityAccess(wo.facilityId, me);
  const problem = actionProblem(wo, action, actor(me));
  if (problem) return { error: problem };
  return { wo, next: nextStatus(wo.status, action)! };
}

/** Update only if nobody changed the status meanwhile. */
export async function guardedUpdate(tx: Pick<typeof db, "update">, wo: { id: number; status: typeof workOrders.$inferSelect.status }, set: Partial<typeof workOrders.$inferInsert>) {
  const rows = await tx.update(workOrders).set(set).where(and(eq(workOrders.id, wo.id), eq(workOrders.status, wo.status))).returning({ id: workOrders.id });
  return rows.length === 1;
}

/* ── Start / hold / resume ── */

export async function progressJob(me: CurrentUser, woId: number, step: "start" | "hold" | "resume", holdReason?: string, inTx?: InTx): Promise<StepResult> {
  if (step === "hold" && !holdReason) return { error: "Say why the job is on hold (for example: waiting for a spare part)." };
  const r = await loadForAction(woId, step, me);
  if (r.error !== undefined) return { error: r.error };
  const { wo, next } = r;
  if (step !== "hold") {
    const kept = quarantineBlock(await quarantineFor(wo.assetId), "work", wo.type); // wave 40: kept as found
    if (kept) return { error: kept };
  }
  const ok = await txn(async (tx) => {
    if (inTx) await inTx(tx);
    const set: Partial<typeof workOrders.$inferInsert> = { status: next };
    if (step === "start") { set.startedAt = new Date(); if (!wo.assignedToId) { set.assignedToId = me.id; set.assignedAt = new Date(); } }
    if (step === "hold") set.holdReason = holdReason!;
    if (step === "resume") set.holdReason = null;
    if (!(await guardedUpdate(tx, wo, set))) throw new Rollback(false);
    await logActivity("work_order", wo.id, step === "start" ? "started" : step === "hold" ? "on_hold" : "resumed",
      step === "start" ? `Work started by ${me.name}` : step === "hold" ? `On hold — ${holdReason}` : "Work resumed", me.name, tx);
    if (step === "start") await applyAssetEffect("start", wo, { actor: me.name }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  refreshJob(wo.id, wo.assetId);
  return { ok: true };
}

/* ── Complete ── */

const CompleteSchema = z.object({
  workOrderId: reqId("Work order"), resolution: text(4000), rootCause: text(500), failureCode: text(32),
  laborHours: num("Labour hours", 0, 1000), cost: num("Cost", 0, 1e10), currency: text(3),
  returnToService: z.preprocess((v) => v === "on" || v === "true" || v === "1", z.boolean()),
  /** Wave 40: why the job is finished without a passed electrical safety test after the repair. */
  safetyTestReason: text(500),
});

/**
 * Complete a job from the completion form's fields (checklist answers as ck_result_<i>, ck_value_<i>, ck_note_<i>).
 * Writes the maintenance history entry, completes a PPM visit, actions a recall, and tells the reporter.
 * Wave 40: a corrective job needs a failure code (`failureCode`), unless `opts.failureCodeOptional` (the My jobs sync).
 */
export async function completeJob(me: CurrentUser, fd: FormData, inTx?: InTx, opts: { failureCodeOptional?: boolean; startFirst?: "start" | "resume" } = {}): Promise<StepResult> {
  const p = CompleteSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  // Wave 42: `startFirst` starts (or resumes) the job in the same transaction as completing it (the My jobs sync), so a
  // completion that fails a check leaves the job exactly as it was.
  const first = opts.startFirst;
  const r = await loadForAction(d.workOrderId, first ?? "complete", me);
  if (r.error !== undefined) return { error: r.error };
  const loaded = r.wo;
  const startedNow = first === "start" ? new Date() : null;
  const wo: WorkOrderRow = first
    ? { ...loaded, status: "IN_PROGRESS", holdReason: null, startedAt: loaded.startedAt ?? startedNow, assignedToId: loaded.assignedToId ?? me.id }
    : loaded;
  if (first) { const p2 = actionProblem(wo, "complete", actor(me)); if (p2) return { error: p2 }; }
  const next = first ? nextStatus(wo.status, "complete")! : r.next;
  const codeProblem = failureCodeProblem(wo.type, d.failureCode, opts.failureCodeOptional);
  if (codeProblem) return { error: codeProblem, fields: { failureCode: codeProblem } };
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
  const kept = quarantineBlock(await quarantineFor(wo.assetId), "work", wo.type); // wave 40: kept as found
  if (kept) return { error: kept };
  // Wave 40 (IEC 62353): a passed safety test after a repair, or a reason to go on without one (warn, not block).
  const gate = wo.type === "CORRECTIVE" ? await safetyGate(wo.assetId, "REPAIR", todayISO(wo.startedAt ?? wo.reportedAt)) : null;
  if (gate && !d.safetyTestReason) return { error: gate, fields: { safetyTestReason: "Give the reason, or record the test first." } };
  const now = new Date();
  // Wave 27: test equipment used must be in calibration today.
  const used = await checkInstruments(fd, wo.facilityId, todayISO(now));
  if ("problem" in used) return { error: used.problem, fields: { testEquipment: used.problem } };
  const meter = await readingAtVisit(fd, wo.assetId, todayISO(now), me);
  if ("problem" in meter) return { error: meter.problem, fields: { meterReading: meter.problem } };
  const [assignee] = wo.assignedToId ? await db.select({ name: users.name }).from(users).where(eq(users.id, wo.assignedToId)) : [];
  const currency = d.cost != null ? (d.currency ?? "EGP").toUpperCase() : null;
  const held = await calibrationHeld(wo.assetId); // wave 37: a failed calibration keeps it out of service
  const ok = await txn(async (tx) => {
    if (inTx) await inTx(tx);
    if (first) {
      const set: Partial<typeof workOrders.$inferInsert> = first === "start"
        ? { status: "IN_PROGRESS", startedAt: startedNow, ...(loaded.assignedToId ? {} : { assignedToId: me.id, assignedAt: startedNow }) }
        : { status: "IN_PROGRESS", holdReason: null };
      if (!(await guardedUpdate(tx, loaded, set))) throw new Rollback(false);
      await logActivity("work_order", wo.id, first === "start" ? "started" : "resumed", first === "start" ? `Work started by ${me.name}` : "Work resumed", me.name, tx);
      if (first === "start") await applyAssetEffect("start", loaded, { actor: me.name }, tx);
    }
    const downtimeEnd = wo.deviceDown && d.returnToService ? now : wo.downtimeEnd;
    if (!(await guardedUpdate(tx, wo, {
      status: next, completedAt: now, startedAt: wo.startedAt ?? now, resolution, rootCause: d.rootCause ?? null,
      failureCode: d.failureCode ?? wo.failureCode ?? null,
      // Wave 39: labour booked earlier (from My jobs) stays when the form leaves the hours empty.
      laborHours: completedLabour(d.laborHours, wo.laborHours), cost: d.cost != null ? String(d.cost) : null, currency, downtimeEnd, checklist,
    }))) throw new Rollback(false);
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
    await saveInstruments(tx, eventId, used.ok);
    await meter.save(tx);
    if (gate && d.safetyTestReason) await tx.insert(safetyTestWaivers).values({ assetId: wo.assetId, context: "REPAIR", workOrderId: wo.id, reason: d.safetyTestReason, byId: me.id, byName: me.name });
    // A recall job done = that device is actioned for the recall.
    await tx.update(recallAssets).set({ status: "ACTIONED", actionedAt: now, note: `Done under ${wo.number}` })
      .where(and(eq(recallAssets.workOrderId, wo.id), eq(recallAssets.status, "PENDING")));
    await logActivity("work_order", wo.id, "completed", `Completed by ${me.name}: ${resolution.slice(0, 200)}${failed ? ` — ${failed} checklist item${failed === 1 ? "" : "s"} failed` : ""}${wo.deviceDown ? (d.returnToService ? " — back in service" : " — still out of use") : ""}${gate && d.safetyTestReason ? ` — no safety test after repair: ${d.safetyTestReason}` : ""}`.slice(0, 600), me.name, tx);
    await logActivity("asset", wo.assetId, "maintenance", `${wo.number} completed — ${resolution.slice(0, 120)}`, me.name, tx);
    await applyAssetEffect("complete", wo, { returnToService: d.returnToService, actor: me.name, calibrationHeld: held }, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  if (wo.reportedById && wo.reportedById !== me.id) {
    await notifyUsers([wo.reportedById], {
      kind: "work_order_completed", title: `${wo.number} is fixed: ${wo.title}`.slice(0, 200),
      body: held && wo.deviceDown ? "The job is done. The device stays out of service until a passing calibration is recorded." : d.returnToService || !wo.deviceDown ? "The device is back in service." : "The job is done but the device is still out of use.", href: woPath(wo.id),
      dedupeKey: `wo_completed:${wo.id}:${now.getTime()}`,
    });
  }
  refreshJob(wo.id, wo.assetId);
  revalidatePath("/assets/maintenance");
  return { ok: true };
}

/* ── Failure code (wave 40) ── */

/** Set or change a job's failure code after it is finished (or while it is open). Cancelled jobs are left alone. */
export async function setFailureCode(me: CurrentUser, woId: number, code: string, inTx?: InTx): Promise<StepResult> {
  if (!isFailureCode(code)) return { error: "Choose a failure code from the list.", fields: { failureCode: "Choose a failure code from the list." } };
  const [wo] = await db.select({ id: workOrders.id, facilityId: workOrders.facilityId, assetId: workOrders.assetId, status: workOrders.status, failureCode: workOrders.failureCode })
    .from(workOrders).where(eq(workOrders.id, woId));
  if (!wo) return { error: "That work order no longer exists." };
  await requireFacilityAccess(wo.facilityId, me);
  if (wo.status === "CANCELLED") return { error: "A cancelled job has no failure code." };
  if (wo.failureCode === code) return { ok: true };
  await txn(async (tx) => {
    if (inTx) await inTx(tx);
    await tx.update(workOrders).set({ failureCode: code }).where(eq(workOrders.id, wo.id));
    await logActivity("work_order", wo.id, "failure_code", `Failure code ${wo.failureCode ? `changed from ${failureCodeLabel(wo.failureCode)} ` : ""}set to ${failureCodeLabel(code)} by ${me.name}`, me.name, tx);
  });
  refreshJob(wo.id, wo.assetId);
  return { ok: true };
}

/* ── Parts on a job ── */

export const JobPartSchema = z.object({ workOrderId: reqId("Work order"), partId: reqId("Part"), quantity: int("Quantity", 1, 10000), step: z.enum(["issue", "return"]) });

/** Use parts on a job, or return unused ones. Only while the job is open; the part must be in the job's hospital. */
export async function bookJobPart(me: CurrentUser, input: z.infer<typeof JobPartSchema>, inTx?: InTx): Promise<{ ok: true; partName: string; quantity: number } | { error: string }> {
  const { workOrderId, partId, step } = input;
  const quantity = input.quantity ?? 1;
  const [wo] = await db.select({ id: workOrders.id, number: workOrders.number, facilityId: workOrders.facilityId, status: workOrders.status, assetId: workOrders.assetId })
    .from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) return { error: "That work order no longer exists." };
  await requireFacilityAccess(wo.facilityId, me);
  if (!isActive(wo.status) && wo.status !== "COMPLETED") return { error: "Parts can only be booked on an open or just-completed job." };
  const [part] = await db.select({ facilityId: spareParts.facilityId, active: spareParts.active }).from(spareParts).where(eq(spareParts.id, partId));
  if (!part || part.facilityId !== wo.facilityId) return { error: "That part isn't stocked in this hospital." };
  const r = await txn<Awaited<ReturnType<typeof applyMovement>>>(async (tx) => {
    if (inTx) await inTx(tx);
    // Lock the part first (audit wave 36): two returns at once can't both pass "not more than issued to this job".
    await tx.select({ id: spareParts.id }).from(spareParts).where(eq(spareParts.id, partId)).for("update");
    const used = step === "return" ? await issuedToJob(partId, wo.id, tx) : 0;
    const res = await applyMovement({ partId, kind: step === "issue" ? "ISSUE" : "RETURN", quantity, workOrderId: wo.id, actor: me.name }, tx, used);
    if (!res.ok) throw new Rollback(res);
    {
      await logActivity("work_order", wo.id, step === "issue" ? "part_used" : "part_returned", `${step === "issue" ? "Used" : "Returned"} ${quantity} × ${res.partName}`, me.name, tx);
      await logActivity("part", partId, step === "issue" ? "issued" : "returned", `${quantity} ${step === "issue" ? "issued to" : "returned from"} ${wo.number} (stock ${res.after})`, me.name, tx);
    }
    return res;
  });
  if (!r.ok) return { error: r.error };
  await notifyIfLow(r, partId);
  revalidatePath(woPath(wo.id));
  revalidatePath(`/assets/parts/${partId}`);
  revalidatePath("/assets/my-jobs");
  return { ok: true, partName: r.partName, quantity };
}

/* ── Notes and labour (wave 39) ── */

/** A note on the job, kept in its activity trail. */
export async function addJobNote(me: CurrentUser, wo: { id: number; assetId: number }, note: string, inTx?: InTx): Promise<StepResult> {
  await txn(async (tx) => {
    if (inTx) await inTx(tx);
    await logActivity("work_order", wo.id, "note", `Note from ${me.name}: ${note.slice(0, 2000)}`, me.name, tx);
  });
  revalidatePath(woPath(wo.id));
  return { ok: true };
}

/** Labour time added to the job's total. */
export async function addJobLabour(me: CurrentUser, wo: { id: number; assetId: number; status: typeof workOrders.$inferSelect.status }, hours: number, inTx?: InTx): Promise<StepResult> {
  const ok = await txn(async (tx) => {
    if (inTx) await inTx(tx);
    if (!(await guardedUpdate(tx, wo, { laborHours: sql`coalesce(${workOrders.laborHours}, 0) + ${hours}` as unknown as number }))) throw new Rollback(false);
    await logActivity("work_order", wo.id, "labour", `${hours} h labour booked by ${me.name}`, me.name, tx);
    return true;
  });
  if (!ok) return { error: RACE };
  revalidatePath(woPath(wo.id));
  return { ok: true };
}

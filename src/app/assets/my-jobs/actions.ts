"use server";
/**
 * My jobs sync (wave 39): changes a technician made on their phone, sent when there is signal. Each change goes
 * through the same steps as the work order page. A change to a job someone else has changed since the phone saw it
 * is not applied: it comes back as a conflict with the job as it is now.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { offlineSyncLog, workOrders } from "@/db/schema";
import { facilityScope, requirePermission, type CurrentUser } from "@/lib/auth/session";
import {
  CHANGE_KINDS, changeProblem, checksVersion, completeSteps, effectiveBase, jobVersion, type SyncResult,
} from "@/lib/assets/offline-jobs";
import { serverView } from "@/lib/assets/my-jobs-server";
import { actor, addJobLabour, AlreadyApplied, addJobNote, bookJobPart, completeJob, type Tx } from "@/lib/assets/work-order-steps-server";

const AnswerSchema = z.object({
  result: z.enum(["PASS", "FAIL", "NA"]).nullable().optional(),
  value: z.union([z.string().max(32), z.number()]).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

const ChangeSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  jobId: z.number().int().positive(),
  kind: z.enum(CHANGE_KINDS),
  baseVersion: z.string().max(16),
  note: z.string().trim().min(1).max(2000).optional(),
  hours: z.number().positive().max(24).optional(),
  partId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
  complete: z.object({
    resolution: z.string().max(4000).optional(), rootCause: z.string().max(500).optional(), failureCode: z.string().max(32).optional(),
    laborHours: z.number().min(0).max(1000).optional(), returnToService: z.boolean(),
    checklist: z.array(AnswerSchema).max(300).optional(),
  }).optional(),
});
type Change = z.infer<typeof ChangeSchema>;

const MAX_BATCH = 50;

/** Apply queued changes in order. Returns one result per change; the phone marks each synced or conflict. */
export async function syncMyJobsAction(input: unknown): Promise<{ results: SyncResult[] } | { error: string }> {
  const me = await requirePermission("maintenance.edit");
  const p = z.array(ChangeSchema).max(MAX_BATCH).safeParse(input);
  if (!p.success) return { error: "The phone sent changes this version of the app can't read. Reload My jobs." };
  const scope = await facilityScope(me);
  // Versions this person's own changes produced in this batch, per job.
  const moved = new Map<number, Map<string, string>>();
  const results: SyncResult[] = [];
  for (const c of p.data) {
    try {
      results.push(await syncOne(me, c, scope, moved));
    } catch (e) {
      console.error("my jobs sync", c.key, e);
      results.push({ key: c.key, outcome: "conflict", message: "The server couldn't save this. Send it again, or open the job page." });
    }
  }
  return { results };
}

async function syncOne(me: CurrentUser, c: Change, scope: number[] | null, moved: Map<number, Map<string, string>>): Promise<SyncResult> {
  const [seen] = await db.select({ key: offlineSyncLog.key }).from(offlineSyncLog).where(and(eq(offlineSyncLog.userId, me.id), eq(offlineSyncLog.key, c.key)));
  if (seen) return { key: c.key, outcome: "synced", message: "Already saved." };
  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, c.jobId));
  if (!wo) return { key: c.key, outcome: "conflict", message: "That job no longer exists." };
  // Checked here (not by redirecting) so one job in another hospital doesn't stop the rest of the batch.
  if (scope !== null && !scope.includes(wo.facilityId)) return { key: c.key, outcome: "conflict", message: "You no longer have access to this job's hospital." };
  const conflict = async (message: string): Promise<SyncResult> => ({ key: c.key, outcome: "conflict", message, server: (await serverView(wo.id)) ?? undefined });

  const problem = changeProblem(wo, c.kind, actor(me));
  if (problem) return conflict(problem);
  const before = jobVersion(wo);
  if (checksVersion(c.kind) && effectiveBase(c.baseVersion, moved.get(wo.id) ?? new Map()) !== before) {
    return conflict("Someone else changed this job after you opened it. Check it, then send yours again or drop it.");
  }
  // Wave 42: the key is claimed first, inside the step's own transaction. A second sync of the same change (another
  // tab, a resend while the first is still running) finds it taken and its whole step is rolled back.
  const claim = async (tx: Tx) => {
    const got = await tx.insert(offlineSyncLog).values({ userId: me.id, key: c.key, workOrderId: wo.id, kind: c.kind }).onConflictDoNothing().returning({ key: offlineSyncLog.key });
    if (!got.length) throw new AlreadyApplied();
  };
  try {
    return await applyChange(me, c, wo, before, claim, conflict, moved);
  } catch (e) {
    if (e instanceof AlreadyApplied) return { key: c.key, outcome: "synced", message: "Already saved." };
    throw e;
  }
}

async function applyChange(me: CurrentUser, c: Change, wo: typeof workOrders.$inferSelect, before: string, record: (tx: Tx) => Promise<void>,
  conflict: (message: string) => Promise<SyncResult>, moved: Map<number, Map<string, string>>): Promise<SyncResult> {

  let r: { ok: true } | { error: string };
  switch (c.kind) {
    case "note":
      if (!c.note) return conflict("The note is empty.");
      r = await addJobNote(me, wo, c.note, record);
      break;
    case "labour":
      if (!c.hours) return conflict("The hours are missing.");
      r = await addJobLabour(me, wo, c.hours, record);
      break;
    case "part": {
      if (!c.partId) return conflict("The part is missing.");
      const b = await bookJobPart(me, { workOrderId: wo.id, partId: c.partId, quantity: c.quantity ?? 1, step: "issue" }, record);
      r = "error" in b ? { error: b.error } : { ok: true };
      break;
    }
    case "complete": {
      const d = c.complete;
      if (!d) return conflict("The completion details are missing.");
      // A job not yet started (or on hold) is started or resumed first, in the same transaction as completing it
      // (wave 42): if the completion fails, the job stays as it was and a resend doesn't conflict with itself.
      const pre = (completeSteps(wo.status) ?? []).find((x) => x !== "complete");
      const startFirst = pre === "start" ? "start" : pre === "resume" ? "resume" : undefined;
      const fd = new FormData();
      fd.set("workOrderId", String(wo.id));
      if (d.resolution) fd.set("resolution", d.resolution);
      if (d.rootCause) fd.set("rootCause", d.rootCause);
      if (d.failureCode) fd.set("failureCode", d.failureCode);
      if (d.laborHours != null) fd.set("laborHours", String(d.laborHours));
      if (d.returnToService) fd.set("returnToService", "on");
      (d.checklist ?? []).forEach((a, i) => {
        if (a.result) fd.set(`ck_result_${i}`, a.result);
        if (a.value != null && a.value !== "") fd.set(`ck_value_${i}`, String(a.value));
        if (a.note) fd.set(`ck_note_${i}`, a.note);
      });
      // Wave 40: the failure code is optional from a phone (older phones don't send it); it can be added on the job page.
      r = await completeJob(me, fd, record, { failureCodeOptional: true, startFirst });
      break;
    }
  }
  if ("error" in r) return conflict(r.error);
  const [after] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id));
  const now = after ? jobVersion(after) : before;
  if (now === before) return { key: c.key, outcome: "synced" };
  if (!moved.has(wo.id)) moved.set(wo.id, new Map());
  moved.get(wo.id)!.set(before, now);
  return { key: c.key, outcome: "synced", version: now };
}

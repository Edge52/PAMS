"use server";
/**
 * My jobs, wave 43: "Start" on a planned visit that has no job yet. Raises the job for the person (the same step as
 * "Create work orders" on the schedule, with its checks) and starts it. Needs signal: a job number can't be made on
 * the phone. Who may start which visit: lib/assets/my-visits.ts.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workOrders } from "@/db/schema";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { myVisits } from "@/lib/assets/my-jobs-server";
import { progressJob } from "@/lib/assets/work-order-steps-server";
import { todayISO } from "@/lib/format";
import { createPpmWorkOrdersAction } from "../work-orders/actions";

export async function startVisitAction(eventId: number): Promise<{ ok: string; jobId: number } | { error: string }> {
  const me = await requirePermission("maintenance.edit");
  if (!Number.isInteger(eventId) || eventId <= 0) return { error: "That visit can't be read. Reload My jobs." };
  const [v] = await myVisits(me, await facilityScope(me), todayISO(), eventId);
  if (!v) return { error: "This visit is no longer waiting for you: it may have a job already, or be someone else's. Reload My jobs." };
  const f = new FormData();
  f.set("eventIds", String(eventId)); f.set("assigneeId", String(me.id)); f.set("from", ""); f.set("to", ""); f.set("returnPath", "/assets/my-jobs"); f.set("stay", "1");
  const res = await createPpmWorkOrdersAction(null, f);
  if (res?.error) return { error: res.error };
  const [wo] = await db.select({ id: workOrders.id, number: workOrders.number }).from(workOrders).where(eq(workOrders.plannedEventId, eventId));
  if (!wo) return { error: "The job wasn't created. Try again, or use the maintenance schedule." };
  const s = await progressJob(me, wo.id, "start");
  const warn = res?.ok && /Warning|kept as found/.test(res.ok) ? ` ${res.ok.replace(/^\S+ created[^.]*\.\s*/, "")}` : "";
  return { ok: "error" in s ? `${wo.number} created for you, not started: ${s.error}` : `${wo.number} started.${warn}`, jobId: wo.id };
}

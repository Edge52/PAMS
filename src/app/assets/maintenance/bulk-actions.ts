"use server";
/**
 * Wave 41: bulk actions on ticked PPM visits (Maintenance › Schedule): move them to another date, or give them to one
 * person (a job is raised for visits without one; jobs already raised are reassigned). Visits outside the user's
 * hospitals are left alone; each change is logged.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, maintenanceEvents, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { assignableUsers } from "@/lib/assets/work-order-server";
import { guardedUpdate, loadForAction } from "@/lib/assets/work-order-steps-server";
import { bulkIds, parseBulk, PpmBulkSchema, reschedulable } from "@/lib/bulk";
import { logActivity } from "@/lib/server-utils";
import { createPpmWorkOrdersAction } from "../work-orders/actions";

const PAGE = "/assets/maintenance";
function back(fd: FormData, key: "notice" | "error", msg: string): never {
  const rp = String(fd.get("returnPath") ?? "");
  const base = rp.startsWith(PAGE) && !rp.includes("//") ? rp.replace(/[?&](notice|error)=[^&]*/g, "") : `${PAGE}?tab=schedule`;
  redirect(`${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}
const withWhat = (fd: FormData, what: string) => { const out = new FormData(); for (const [k, v] of fd.entries()) out.append(k, v); out.set("what", what); return out; };
const left = (s: string[]) => (s.length ? ` Left alone: ${s.slice(0, 5).join(", ")}${s.length > 5 ? ` and ${s.length - 5} more` : ""}.` : "");

async function ticked(fd: FormData, me: Awaited<ReturnType<typeof requirePermission>>) {
  const ids = bulkIds(fd, "eventIds");
  if (!ids.length) back(fd, "error", "Tick the visits first.");
  const scope = await facilityScope(me);
  const rows = await db.select({ id: maintenanceEvents.id, status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate, assetId: assets.id, tag: assets.assetTag,
    facilityId: assets.facilityId, woId: workOrders.id, woNumber: workOrders.number, woStarted: workOrders.startedAt })
    .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).leftJoin(workOrders, eq(workOrders.plannedEventId, maintenanceEvents.id))
    .where(and(inArray(maintenanceEvents.id, ids), scopeWhere(assets.facilityId, scope)));
  return { rows, outside: ids.length - rows.length };
}

/** Move the ticked visits (scheduled or overdue) to one date; their jobs' due dates move with them. */
export async function bulkReschedulePpmAction(fd: FormData): Promise<void> {
  const me = await requirePermission("maintenance.edit");
  const p = parseBulk(PpmBulkSchema, withWhat(fd, "reschedule"), ["what", "date"]);
  if ("error" in p) return back(fd, "error", p.error);
  const date = p.data.date!;
  const { rows, outside } = await ticked(fd, me);
  const skipped: string[] = outside ? [`${outside} not in your hospitals`] : [];
  const move = rows.filter((r) => { const ok = reschedulable(r.status) && r.scheduledDate !== date; if (!ok) skipped.push(`${r.tag} (${reschedulable(r.status) ? "already on that date" : "done or cancelled"})`); return ok; });
  if (move.length) {
    await db.transaction(async (tx) => {
      await tx.update(maintenanceEvents).set({ scheduledDate: date, status: "SCHEDULED" }).where(inArray(maintenanceEvents.id, move.map((r) => r.id)));
      const jobs = move.filter((r) => r.woId && !r.woStarted).map((r) => r.woId!);
      if (jobs.length) await tx.update(workOrders).set({ dueAt: new Date(`${date}T23:59:59Z`) }).where(inArray(workOrders.id, jobs));
      for (const r of move) await logActivity("asset", r.assetId, "maintenance", `PPM visit moved from ${r.scheduledDate ?? "no date"} to ${date} (bulk)`, me.name, tx);
    });
  }
  revalidatePath(PAGE); revalidatePath("/assets/work-orders");
  back(fd, move.length ? "notice" : "error", `${move.length} visit${move.length === 1 ? "" : "s"} moved to ${date}.${left(skipped)}`);
}

/** Give the ticked visits to one person: a job for each visit without one, and jobs already raised reassigned. */
export async function bulkAssignPpmAction(fd: FormData): Promise<void> {
  const me = await requirePermission("maintenance.edit");
  const p = parseBulk(PpmBulkSchema, withWhat(fd, "assign"), ["what", "assigneeId"]);
  if ("error" in p) return back(fd, "error", p.error);
  const assigneeId = p.data.assigneeId!;
  if (assigneeId !== me.id && !can(me.role, "workorders.assign")) back(fd, "error", "Only the biomedical lead can give visits to someone else.");
  const { rows, outside } = await ticked(fd, me);
  const skipped: string[] = outside ? [`${outside} not in your hospitals`] : [];
  const open = rows.filter((r) => { const ok = reschedulable(r.status); if (!ok) skipped.push(`${r.tag} (done or cancelled)`); return ok; });
  let messages = "";
  // Visits without a job: the usual "create work orders" step, with its checks (hospital, quarantine, competency).
  const fresh = open.filter((r) => !r.woId);
  if (fresh.length) {
    const f = new FormData();
    f.set("eventIds", fresh.map((r) => r.id).join(",")); f.set("assigneeId", String(assigneeId)); f.set("from", ""); f.set("to", ""); f.set("returnPath", PAGE); f.set("stay", "1");
    const res = await createPpmWorkOrdersAction({}, f);
    if (res?.error) skipped.push(res.error.replace(/\.$/, ""));
    else messages += `${res?.ok ?? `${fresh.length} jobs created.`} `;
  }
  // Visits whose job exists: reassign it (needs the right to assign).
  const raised = open.filter((r) => r.woId);
  let reassigned = 0;
  if (raised.length && !can(me.role, "workorders.assign")) skipped.push(`${raised.length} already have a job (ask the biomedical lead to reassign)`);
  else {
    const people = new Map<number, Awaited<ReturnType<typeof assignableUsers>>>();
    for (const r of raised) {
      const l = await loadForAction(r.woId!, "assign", me);
      if ("error" in l) { skipped.push(`${r.woNumber}: ${l.error}`); continue; }
      if (!people.has(l.wo.facilityId)) people.set(l.wo.facilityId, await assignableUsers(l.wo.facilityId));
      const who = people.get(l.wo.facilityId)!.find((u) => u.id === assigneeId);
      if (!who) { skipped.push(`${r.woNumber} (that person can't work in its hospital)`); continue; }
      if (l.wo.assignedToId === who.id) continue;
      const ok = await db.transaction(async (tx) => {
        if (!(await guardedUpdate(tx, l.wo, { status: l.next, assignedToId: who.id, assignedAt: new Date() }))) return false;
        await logActivity("work_order", l.wo.id, "assigned", `${l.wo.assignedToId ? "Reassigned" : "Assigned"} to ${who.name} from the PPM schedule (bulk)`, me.name, tx);
        return true;
      });
      if (ok) reassigned++; else skipped.push(`${r.woNumber} (changed by someone else)`);
    }
  }
  revalidatePath(PAGE); revalidatePath("/assets/work-orders");
  const done = `${messages}${reassigned ? `${reassigned} job${reassigned === 1 ? "" : "s"} reassigned.` : ""}`.trim();
  back(fd, done ? "notice" : "error", `${done || "Nothing assigned."}${left(skipped)}`);
}

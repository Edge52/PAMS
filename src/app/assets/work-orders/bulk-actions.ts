"use server";
/**
 * Wave 41: bulk actions on ticked work orders. Each job goes through the same checks as one at a time
 * (`loadForAction`: the hospital, the status rules), changes under a status guard and gets its own audit entry.
 */
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { recallAssets, workOrders } from "@/db/schema";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { calibrationHeld } from "@/lib/assets/calibration-server";
import { applyAssetEffect, assignableUsers } from "@/lib/assets/work-order-server";
import { guardedUpdate, loadForAction } from "@/lib/assets/work-order-steps-server";
import { responseDue } from "@/lib/assets/work-orders";
import { bulkIds, bulkNotice, duplicatesPlan, parseBulk, WoBulkSchema } from "@/lib/bulk";
import { notifyUsers } from "@/lib/notifications";
import { logActivity } from "@/lib/server-utils";
import { humanize } from "@/lib/status";

const LIST = "/assets/work-orders";
function back(fd: FormData, key: "notice" | "error", msg: string): never {
  const rp = String(fd.get("returnPath") ?? "");
  const base = rp.startsWith(LIST) && !rp.includes("//") ? rp.replace(/[?&](notice|error)=[^&]*/g, "") : LIST;
  redirect(`${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

/** Give the ticked jobs to one person. */
export async function bulkAssignAction(fd: FormData): Promise<void> {
  const me = await requirePermission("workorders.assign");
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the work orders first.");
  const parsed = parseBulk(WoBulkSchema, withWhat(fd, "assign"), ["what", "assigneeId"]);
  if ("error" in parsed) return back(fd, "error", parsed.error);
  const people = new Map<number, Awaited<ReturnType<typeof assignableUsers>>>();
  // Only jobs in the user's hospitals (loadForAction checks again, one by one).
  const scope = await facilityScope(me);
  const inScope = (await db.select({ id: workOrders.id }).from(workOrders).where(and(inArray(workOrders.id, ids), scopeWhere(workOrders.facilityId, scope)))).map((r) => r.id);
  const skipped: string[] = ids.length > inScope.length ? [`${ids.length - inScope.length} not in your hospitals`] : [];
  let changed = 0, whoName = "";
  for (const id of inScope) {
    const r = await loadForAction(id, "assign", me);
    if ("error" in r) { skipped.push(`#${id}: ${r.error}`); continue; }
    const { wo, next } = r;
    if (!people.has(wo.facilityId)) people.set(wo.facilityId, await assignableUsers(wo.facilityId));
    const who = people.get(wo.facilityId)!.find((u) => u.id === parsed.data.assigneeId);
    if (!who) { skipped.push(`${wo.number} (that person can't work in its hospital)`); continue; }
    if (who.id === wo.assignedToId) { skipped.push(`${wo.number} (already theirs)`); continue; }
    whoName = who.name;
    const ok = await db.transaction(async (tx) => {
      if (!(await guardedUpdate(tx, wo, { status: next, assignedToId: who.id, assignedAt: new Date() }))) return false;
      await logActivity("work_order", wo.id, "assigned", `${wo.assignedToId ? "Reassigned" : "Assigned"} to ${who.name} (bulk)`, me.name, tx);
      return true;
    });
    if (ok) changed++; else skipped.push(`${wo.number} (changed by someone else)`);
  }
  if (changed && parsed.data.assigneeId !== me.id) {
    await notifyUsers([parsed.data.assigneeId!], { kind: "work_order_assigned", title: `${changed} job${changed === 1 ? "" : "s"} assigned to you`, body: `Assigned by ${me.name}.`,
      href: `${LIST}?tab=mine`, dedupeKey: `wo_bulk_assign:${parsed.data.assigneeId}:${Date.now()}` });
  }
  revalidatePath(LIST); revalidatePath("/assets/my-jobs");
  const left = skipped.length ? ` Left alone: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ""}.` : "";
  back(fd, changed ? "notice" : "error", changed ? `${changed} work order${changed === 1 ? "" : "s"} assigned to ${whoName}.${left}` : `No work order assigned.${left}`);
}

/** Set one priority on the ticked open jobs (the response target moves with it until a job is started). */
export async function bulkPriorityAction(fd: FormData): Promise<void> {
  const me = await requirePermission("workorders.assign");
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the work orders first.");
  const parsed = parseBulk(WoBulkSchema, withWhat(fd, "priority"), ["what", "priority"]);
  if ("error" in parsed) return back(fd, "error", parsed.error);
  const priority = parsed.data.priority!;
  const scope = await facilityScope(me);
  const rows = await db.select().from(workOrders).where(and(inArray(workOrders.id, ids), scopeWhere(workOrders.facilityId, scope),
    inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"])));
  const change = rows.filter((w) => w.priority !== priority);
  await db.transaction(async (tx) => {
    for (const w of change) {
      await tx.update(workOrders).set({ priority, ...(w.startedAt ? {} : { dueAt: responseDue(w.reportedAt, priority) }) }).where(eq(workOrders.id, w.id));
      await logActivity("work_order", w.id, "priority", `Priority ${humanize(w.priority).toLowerCase()} → ${humanize(priority).toLowerCase()} (bulk)`, me.name, tx);
    }
  });
  revalidatePath(LIST);
  const left = ids.length - change.length;
  back(fd, "notice", bulkNotice(change.length, change.length === 1 ? "work order" : "work orders", left ? [`${left} already ${humanize(priority).toLowerCase()}, finished, or not in your hospitals`] : []));
}

/** Cancel the ticked jobs as duplicates of one job on the same device, which stays open. */
export async function bulkCloseDuplicatesAction(fd: FormData): Promise<void> {
  const me = await requirePermission("workorders.assign");
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the duplicate work orders first.");
  const parsed = parseBulk(WoBulkSchema, withWhat(fd, "duplicate"), ["what", "keep"]);
  if ("error" in parsed) return back(fd, "error", parsed.error);
  const scope = await facilityScope(me);
  const keepNo = parsed.data.keep!.toUpperCase();
  const [keep] = await db.select().from(workOrders).where(and(eq(workOrders.number, keepNo), scopeWhere(workOrders.facilityId, scope)));
  const ticked = await db.select().from(workOrders).where(and(inArray(workOrders.id, ids), scopeWhere(workOrders.facilityId, scope)));
  const plan = duplicatesPlan(ticked, keep);
  if ("error" in plan) return back(fd, "error", plan.error);
  const now = new Date();
  let changed = 0;
  const skipped = plan.skipped.map((w) => `${w.number} (another device, or finished)`);
  for (const d of plan.cancel) {
    const r = await loadForAction(d.id, "cancel", me);
    if ("error" in r) { skipped.push(`${d.number}: ${r.error}`); continue; }
    const { wo, next } = r;
    const held = await calibrationHeld(wo.assetId);
    const ok = await db.transaction(async (tx) => {
      if (!(await guardedUpdate(tx, wo, { status: next, closedAt: now, downtimeEnd: wo.deviceDown ? wo.downtimeEnd ?? now : wo.downtimeEnd, plannedEventId: null }))) return false;
      await logActivity("work_order", wo.id, "cancelled", `Cancelled by ${me.name} — duplicate of ${keep!.number}`, me.name, tx);
      await tx.update(recallAssets).set({ workOrderId: null }).where(and(eq(recallAssets.workOrderId, wo.id), eq(recallAssets.status, "PENDING")));
      await applyAssetEffect("cancel", wo, { actor: me.name, calibrationHeld: held }, tx);
      return true;
    });
    if (ok) changed++; else skipped.push(`${wo.number} (changed by someone else)`);
  }
  if (changed) await logActivity("work_order", keep!.id, "duplicates", `${changed} duplicate job${changed === 1 ? "" : "s"} cancelled in favour of this one`, me.name);
  revalidatePath(LIST); revalidatePath(`/assets/${keep!.assetId}`);
  back(fd, changed ? "notice" : "error", `${changed} duplicate${changed === 1 ? "" : "s"} of ${keep!.number} cancelled.${skipped.length ? ` Left alone: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ""}.` : ""}`);
}

function withWhat(fd: FormData, what: string): FormData {
  const out = new FormData();
  for (const [k, v] of fd.entries()) out.append(k, v);
  out.set("what", what);
  return out;
}

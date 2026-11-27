import "server-only";
/**
 * Wave 41: fault reports not acknowledged in time — database side, run with the hourly alert job (and every few
 * minutes for life-support faults, see notifications/scheduler). Rules in ./fault-escalation.
 */
import { and, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { assets, biomedOnCall, users, workOrderEscalations, workOrders } from "@/db/schema";
import { notifyUsers } from "@/lib/notifications";
import { isMissingTable } from "@/lib/notifications/prefs-server";
import { getSetting } from "@/lib/settings";
import { ackTargets, faultClass, faultLevelDue, targetLabel } from "./fault-escalation";
import { assignableUsers, assignerIds } from "./work-order-server";

const LOOKBACK_MS = 30 * 86_400_000;

/** Who is on duty now in a hospital: the on-call list when someone is on it, else every technician and engineer. */
export async function onDutyIds(facilityId: number, now = new Date()): Promise<number[]> {
  const allowed = (await assignableUsers(facilityId)).map((u) => u.id);
  try {
    const rows = await db.select({ userId: biomedOnCall.userId }).from(biomedOnCall)
      .where(and(eq(biomedOnCall.facilityId, facilityId), lte(biomedOnCall.startsAt, now), gt(biomedOnCall.endsAt, now))).limit(100);
    const on = rows.map((r) => r.userId).filter((id) => allowed.includes(id));
    if (on.length) return [...new Set(on)];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  return allowed;
}

export async function runFaultEscalations(now = new Date()): Promise<number> {
  try {
    const rows = await db.select({
      id: workOrders.id, number: workOrders.number, title: workOrders.title, type: workOrders.type, status: workOrders.status,
      priority: workOrders.priority, facilityId: workOrders.facilityId, reportedAt: workOrders.reportedAt,
      assignedAt: workOrders.assignedAt, startedAt: workOrders.startedAt, criticality: assets.criticality, tag: assets.assetTag,
    }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(eq(workOrders.status, "OPEN"), eq(workOrders.type, "CORRECTIVE"), gte(workOrders.reportedAt, new Date(now.getTime() - LOOKBACK_MS))))
      .limit(500);
    if (!rows.length) return 0;
    const targets = ackTargets(await getSetting("faultAckMinutes"));
    const done = new Map((await db.select().from(workOrderEscalations).where(inArray(workOrderEscalations.workOrderId, rows.map((r) => r.id))))
      .map((e) => [e.workOrderId, e.level]));
    let created = 0;
    for (const wo of rows) {
      const cls = faultClass(wo.priority, wo.criticality);
      const due = faultLevelDue(wo, targets[cls], now);
      const level = done.get(wo.id) ?? 0;
      if (due <= level) continue;
      const href = `/assets/work-orders/${wo.id}`;
      const body = `Reported ${wo.reportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC; target to pick up: ${targetLabel(targets[cls])}.`;
      if (level < 1) {
        created += await notifyUsers(await onDutyIds(wo.facilityId, now), { kind: "fault_unacknowledged", title: `Not picked up yet: ${wo.number} on ${wo.tag} — ${wo.title}`.slice(0, 200), body, href, dedupeKey: `fault_unack:${wo.id}` });
      }
      if (due >= 2) {
        created += await notifyUsers(await assignerIds(wo.facilityId), { kind: "fault_escalated", title: `Escalated: nobody has picked up ${wo.number} on ${wo.tag}`.slice(0, 200), body, href, dedupeKey: `fault_escalated:${wo.id}` });
      }
      await db.insert(workOrderEscalations).values({ workOrderId: wo.id, level: due, lastAt: now })
        .onConflictDoUpdate({ target: workOrderEscalations.workOrderId, set: { level: due, lastAt: now } });
    }
    return created;
  } catch (e) {
    if (!isMissingTable(e)) console.error("[faults] escalation run failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** The current on-call list of a hospital (entries not yet ended), with names. */
export async function onCallList(facilityId: number, now = new Date()) {
  try {
    return await db.select({ id: biomedOnCall.id, userId: biomedOnCall.userId, name: users.name, startsAt: biomedOnCall.startsAt, endsAt: biomedOnCall.endsAt, setByName: biomedOnCall.setByName })
      .from(biomedOnCall).innerJoin(users, eq(users.id, biomedOnCall.userId))
      .where(and(eq(biomedOnCall.facilityId, facilityId), gt(biomedOnCall.endsAt, now))).orderBy(biomedOnCall.startsAt).limit(200);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

import "server-only";
/** Database side of My jobs (wave 39): the technician's open jobs and the parts they can book, as the phone keeps them. */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, maintenanceEvents, rooms, spareParts, users, workOrders } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { checklistSummary } from "./checklists";
import { MAX_VISITS, VISIT_LOOKAHEAD_DAYS, isOverdue, sortVisits, visitFor, type VisitFor } from "./my-visits";
import { jobVersion, type MyJobsData, type OfflineVisit, type ServerJobView } from "./offline-jobs";
import { assignableUsers } from "./work-order-server";

const OPEN = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;
const MAX_JOBS = 200;
const MAX_PARTS = 400;

/** Open jobs assigned to me, PPM and other, with the parts stocked in their hospitals. */
export async function loadMyJobs(me: CurrentUser, scope: number[] | null, now = new Date()): Promise<MyJobsData> {
  if (scope !== null && !scope.length) return { userId: me.id, loadedAt: now.toISOString(), jobs: [], parts: [], visits: [] };
  const rows = await db.select({
    wo: workOrders, tag: assets.assetTag, typeName: deviceTypes.name, room: rooms.name, department: departments.name,
  }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(eq(workOrders.assignedToId, me.id), inArray(workOrders.status, [...OPEN]), scope === null ? undefined : inArray(workOrders.facilityId, scope)))
    .orderBy(sql`${workOrders.dueAt} asc nulls last`, asc(workOrders.id)).limit(MAX_JOBS);
  const facilityIds = [...new Set(rows.map((r) => r.wo.facilityId))];
  const parts = facilityIds.length ? await db.select({ id: spareParts.id, facilityId: spareParts.facilityId, name: spareParts.name, partNumber: spareParts.partNumber, stock: spareParts.stockQty })
    .from(spareParts).where(and(inArray(spareParts.facilityId, facilityIds), eq(spareParts.active, true))).orderBy(spareParts.name).limit(MAX_PARTS) : [];
  const visits = await myVisits(me, scope, todayISO(now));
  return {
    userId: me.id, loadedAt: now.toISOString(), visits,
    jobs: rows.map(({ wo, tag, typeName, room, department }) => ({
      id: wo.id, number: wo.number, title: wo.title, description: wo.description, status: wo.status, priority: wo.priority, type: wo.type,
      assetId: wo.assetId, tag, typeName, place: [department, room].filter(Boolean).join(" · ") || null, facilityId: wo.facilityId,
      dueAt: wo.dueAt?.toISOString() ?? null, deviceDown: wo.deviceDown, laborHours: wo.laborHours, checklist: wo.checklist,
      version: jobVersion(wo), isPpm: wo.type === "PPM" || wo.plannedEventId != null,
    })),
    parts: parts.map((p) => ({ id: p.id, facilityId: p.facilityId, label: `${p.name} (${p.partNumber})`, stock: p.stock })),
  };
}

/** The job as the server has it now, for a technician reviewing a conflict. */
export async function serverView(woId: number): Promise<ServerJobView | null> {
  const [r] = await db.select({ wo: workOrders, assignee: users.name }).from(workOrders).leftJoin(users, eq(users.id, workOrders.assignedToId)).where(eq(workOrders.id, woId));
  if (!r) return null;
  const s = r.wo.checklist?.length ? checklistSummary(r.wo.checklist) : null;
  return {
    version: jobVersion(r.wo), status: r.wo.status, assignedTo: r.assignee ?? null, laborHours: r.wo.laborHours, resolution: r.wo.resolution,
    holdReason: r.wo.holdReason, checklist: s ? `${s.pass} passed, ${s.fail} failed, ${s.na} n/a, ${s.open} open` : null,
  };
}

/**
 * Wave 43: planned visits without a work order that are this person's (their device's usual technician) or the
 * team's, due within a week or overdue. Rule in ./my-visits. `onlyEventId` checks one visit (for "Start").
 */
export async function myVisits(me: CurrentUser, scope: number[] | null, today: string, onlyEventId?: number): Promise<(OfflineVisit & { for: VisitFor })[]> {
  if (scope !== null && !scope.length) return [];
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + VISIT_LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({
    eventId: maintenanceEvents.id, type: maintenanceEvents.type, status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate,
    assetId: assets.id, assetStatus: assets.status, facilityId: assets.facilityId, tag: assets.assetTag, typeName: deviceTypes.name,
    room: rooms.name, department: departments.name,
  }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(workOrders, eq(workOrders.plannedEventId, maintenanceEvents.id))
    .where(and(
      inArray(maintenanceEvents.status, ["SCHEDULED", "OVERDUE"]), isNull(workOrders.id), ne(assets.status, "DISPOSED"),
      isNotNull(maintenanceEvents.scheduledDate), lte(maintenanceEvents.scheduledDate, until),
      scope === null ? undefined : inArray(assets.facilityId, scope),
      onlyEventId ? eq(maintenanceEvents.id, onlyEventId) : undefined,
    )).orderBy(asc(maintenanceEvents.scheduledDate), asc(maintenanceEvents.id)).limit(1000);
  if (!rows.length) return [];
  // The device's usual technician: whoever had its latest planned job.
  const assetIds = [...new Set(rows.map((r) => r.assetId))];
  const last = await db.selectDistinctOn([workOrders.assetId], { assetId: workOrders.assetId, userId: workOrders.assignedToId }).from(workOrders)
    .where(and(inArray(workOrders.assetId, assetIds), isNotNull(workOrders.plannedEventId), isNotNull(workOrders.assignedToId), ne(workOrders.status, "CANCELLED")))
    .orderBy(workOrders.assetId, desc(workOrders.reportedAt), desc(workOrders.id));
  const usual = new Map(last.map((l) => [l.assetId, l.userId]));
  const team = new Map<number, Set<number>>();
  for (const f of new Set(rows.map((r) => r.facilityId))) team.set(f, new Set((await assignableUsers(f)).map((u) => u.id)));
  const canWorkIn = (u: number, f: number) => team.get(f)?.has(u) ?? false;
  const out: (OfflineVisit & { for: VisitFor })[] = [];
  for (const r of rows) {
    const who = visitFor({ ...r, hasJob: false, usualTechId: usual.get(r.assetId) ?? null }, { id: me.id, scope }, today, canWorkIn);
    if (!who) continue;
    out.push({
      eventId: r.eventId, type: r.type, scheduledDate: r.scheduledDate, overdue: isOverdue(r, today), for: who, mine: who === "mine",
      assetId: r.assetId, tag: r.tag, typeName: r.typeName, place: [r.department, r.room].filter(Boolean).join(" · ") || null, facilityId: r.facilityId,
    });
  }
  return sortVisits(out).slice(0, MAX_VISITS);
}

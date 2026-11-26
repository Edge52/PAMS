import "server-only";
/** Database side of My jobs (wave 39): the technician's open jobs and the parts they can book, as the phone keeps them. */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, rooms, spareParts, users, workOrders } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/session";
import { checklistSummary } from "./checklists";
import { jobVersion, type MyJobsData, type ServerJobView } from "./offline-jobs";

const OPEN = ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;
const MAX_JOBS = 200;
const MAX_PARTS = 400;

/** Open jobs assigned to me, PPM and other, with the parts stocked in their hospitals. */
export async function loadMyJobs(me: CurrentUser, scope: number[] | null, now = new Date()): Promise<MyJobsData> {
  if (scope !== null && !scope.length) return { userId: me.id, loadedAt: now.toISOString(), jobs: [], parts: [] };
  const rows = await db.select({
    wo: workOrders, tag: assets.assetTag, typeName: deviceTypes.name, room: rooms.name, department: departments.name,
  }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(eq(workOrders.assignedToId, me.id), inArray(workOrders.status, [...OPEN]), scope === null ? undefined : inArray(workOrders.facilityId, scope)))
    .orderBy(sql`${workOrders.dueAt} asc nulls last`, asc(workOrders.id)).limit(MAX_JOBS);
  const facilityIds = [...new Set(rows.map((r) => r.wo.facilityId))];
  const parts = facilityIds.length ? await db.select({ id: spareParts.id, facilityId: spareParts.facilityId, name: spareParts.name, partNumber: spareParts.partNumber, stock: spareParts.stockQty })
    .from(spareParts).where(and(inArray(spareParts.facilityId, facilityIds), eq(spareParts.active, true))).orderBy(spareParts.name).limit(MAX_PARTS) : [];
  return {
    userId: me.id, loadedAt: now.toISOString(),
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

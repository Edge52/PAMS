import "server-only";
/** Commissioning plans (wave 14): a plan's rooms with the dates of each device in them. */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  acceptances, assets, commissioningPlans, commissioningRooms, deliveries, deliveryLines, departments, facilities, floors, poLines, projects, purchaseOrders, rooms,
} from "@/db/schema";
import type { CDevice, CPlan, CRoom } from "./commissioning";

const INSTALLED = new Set(["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"]);

export async function loadPlan(id: number) {
  const [row] = await db.select({ plan: commissioningPlans, facility: facilities.name, project: projects.code, projectTitle: projects.title })
    .from(commissioningPlans).innerJoin(facilities, eq(facilities.id, commissioningPlans.facilityId)).leftJoin(projects, eq(projects.id, commissioningPlans.projectId))
    .where(eq(commissioningPlans.id, id));
  return row ?? null;
}

export const planOf = (p: { startsOn: string; installWeeks: number; acceptWeeks: number }): CPlan => ({ startsOn: p.startsOn, installWeeks: p.installWeeks, acceptWeeks: p.acceptWeeks });

/**
 * The plan's rooms, each with its devices: delivered (acceptance record, else the delivery note), installed
 * (acceptance record, else the install date; a device in use with no date counts from the plan's start) and accepted
 * (a signed acceptance).
 */
export async function planRooms(planId: number, startsOn: string): Promise<CRoom[]> {
  const rs = await db.select({ c: commissioningRooms, r: rooms, floor: floors.name, level: floors.level, dept: departments.name })
    .from(commissioningRooms).innerJoin(rooms, eq(rooms.id, commissioningRooms.roomId)).innerJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(departments, eq(departments.id, rooms.departmentId))
    .where(eq(commissioningRooms.planId, planId)).orderBy(asc(floors.level), asc(rooms.code));
  if (!rs.length) return [];
  const devs = await db.select({ roomId: assets.roomId, status: assets.status, installDate: assets.installDate, delivery: deliveries.deliveryDate, a: acceptances })
    .from(assets).leftJoin(acceptances, eq(acceptances.assetId, assets.id))
    .leftJoin(deliveryLines, eq(deliveryLines.id, assets.deliveryLineId)).leftJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
    .where(and(inArray(assets.roomId, rs.map((x) => x.r.id)), ne(assets.status, "DISPOSED")));
  const byRoom = new Map<number, CDevice[]>();
  for (const d of devs) {
    const installedOn = d.a?.installedOn ?? d.installDate ?? (INSTALLED.has(d.status) ? startsOn : null);
    const accepted = d.a?.status === "ACCEPTED" ? d.a.acceptedOn ?? installedOn : null;
    const dev: CDevice = { deliveredOn: d.a?.deliveredOn ?? d.delivery ?? installedOn, installedOn, acceptedOn: accepted };
    (byRoom.get(d.roomId!) ?? byRoom.set(d.roomId!, []).get(d.roomId!)!).push(dev);
  }
  return rs.map(({ c, r, floor, level, dept }) => ({
    roomId: r.id, code: r.code, name: r.name, floorId: r.floorId, floor, level, departmentId: r.departmentId, department: dept,
    handoverPlanned: c.handoverPlanned, installPlanned: c.installPlanned, acceptPlanned: c.acceptPlanned, handoverOn: c.handoverOn, noEquipment: c.noEquipment,
    devices: byRoom.get(r.id) ?? [],
  }));
}

/** Devices the plan's project has ordered but not yet received, by destination department (null = not given). */
export async function awaitingByDepartment(projectId: number | null): Promise<Map<number | null, number>> {
  const out = new Map<number | null, number>();
  if (!projectId) return out;
  const rows = await db.select({ dept: poLines.destinationDepartmentId, n: sql<number>`sum(greatest(${poLines.quantity} - ${poLines.receivedQty}, 0))::int` })
    .from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(eq(purchaseOrders.projectId, projectId), ne(purchaseOrders.status, "CANCELLED"))).groupBy(poLines.destinationDepartmentId);
  for (const r of rows) if (Number(r.n) > 0) out.set(r.dept, Number(r.n));
  return out;
}

/** Plans of a hospital (or several), newest first, with their room counts. */
export async function listPlans(facilityIds: number[] | null, projectId?: number) {
  return db.select({ id: commissioningPlans.id, name: commissioningPlans.name, facilityId: commissioningPlans.facilityId, facility: facilities.name, startsOn: commissioningPlans.startsOn,
    projectId: commissioningPlans.projectId, project: projects.code, rooms: sql<number>`(select count(*)::int from ${commissioningRooms} where ${commissioningRooms.planId} = ${commissioningPlans.id})` })
    .from(commissioningPlans).innerJoin(facilities, eq(facilities.id, commissioningPlans.facilityId)).leftJoin(projects, eq(projects.id, commissioningPlans.projectId))
    .where(and(facilityIds ? inArray(commissioningPlans.facilityId, facilityIds.length ? facilityIds : [-1]) : undefined, projectId != null ? eq(commissioningPlans.projectId, projectId) : undefined))
    .orderBy(sql`${commissioningPlans.id} desc`);
}

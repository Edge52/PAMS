import "server-only";
/** The simulation model of one hospital (wave 14, B3): its published pathways with the rooms, beds, scanners and lifts. */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, floors, liftCores, patientFlows, rooms } from "@/db/schema";
import { buildSimModel, type MFlow } from "./simulate-model";
import { loadFlow } from "./server";

export async function hospitalSimModel(facilityId: number) {
  const pub = await db.select({ id: patientFlows.id }).from(patientFlows)
    .where(and(eq(patientFlows.facilityId, facilityId), eq(patientFlows.status, "PUBLISHED"))).orderBy(asc(patientFlows.name));
  const loaded = (await Promise.all(pub.map((p) => loadFlow(p.id)))).filter((f) => f != null);
  const flows: MFlow[] = loaded.map((f) => ({ id: f.flow.id, name: f.flow.name, kind: f.flow.kind, dailyVolume: f.flow.dailyVolume, arrivalProfile: f.flow.arrivalProfile, steps: f.steps, links: f.links }));
  const rs = await db.select({ id: rooms.id, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId, level: floors.level, beds: rooms.beds }).from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId));
  const ds = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId));
  const kit = await db.select({ typeCode: deviceTypes.code, roomId: assets.roomId }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    // Devices that can be used: not broken, not waiting to be installed.
    .where(and(eq(assets.facilityId, facilityId), sql`${assets.status} in ('IN_SERVICE', 'INSTALLED')`, sql`${assets.roomId} is not null`));
  const lifts = await db.select({ kind: liftCores.kind, cars: liftCores.cars }).from(liftCores).where(eq(liftCores.facilityId, facilityId));
  return { flows, ...buildSimModel(flows, rs, ds, kit, lifts) };
}

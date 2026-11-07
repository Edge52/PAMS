import "server-only";
/** Space planning (wave 17): a hospital's rooms, devices and room templates, scheduled by space-planning.ts. */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, departments, floors, rooms } from "@/db/schema";
import { coreKind, rectPoly } from "@/components/assets/twin/geometry";
import { standardFor } from "./room-standards";
import { loadStandards } from "./room-standards-server";
import { spaceSchedule, type SpaceRoom } from "./space-planning";

export async function facilitySpace(facilityId: number) {
  const fl = await db.select({ id: floors.id, name: floors.name, level: floors.level, upm: floors.unitsPerMetre }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  const ids = fl.map((f) => f.id);
  const rs = ids.length ? await db.select({ id: rooms.id, floorId: rooms.floorId, code: rooms.code, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId, beds: rooms.beds,
    polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h }).from(rooms).where(inArray(rooms.floorId, ids)) : [];
  const devs = rs.length ? await db.select({ roomId: assets.roomId, n: sql<number>`count(*)::int` }).from(assets)
    .where(sql`${inArray(assets.roomId, rs.map((r) => r.id))} and ${assets.status} <> 'DISPOSED'`).groupBy(assets.roomId) : [];
  const nDev = new Map(devs.map((d) => [d.roomId, Number(d.n)]));
  const deps = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name));
  const { rules } = await loadStandards();
  const upm = new Map(fl.map((f) => [f.id, f.upm ?? 10]));
  const spaceRooms: SpaceRoom[] = rs.map((r) => {
    const k = 1 / (upm.get(r.floorId) ?? 10);
    const p = (r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)).map(([x, y]) => [x * k, y * k] as [number, number]);
    return { id: r.id, floorId: r.floorId, code: r.code, name: r.name, type: r.type, departmentId: r.departmentId, beds: r.beds, poly: p, devices: nDev.get(r.id) ?? 0,
      minAreaM2: standardFor(r.name, r.type, rules)?.rule.spec.minAreaM2 ?? null, core: coreKind(r.name) != null };
  });
  return spaceSchedule(fl.map((f) => ({ id: f.id, name: f.name, level: f.level })), spaceRooms, deps);
}

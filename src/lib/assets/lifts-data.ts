/**
 * Lift cores: loading a hospital's floors and rooms for `suggestLifts`, and adding the suggestions it doesn't have yet.
 * Shared by the demo seed and Facilities › Lifts › Suggest from the drawings. Takes the database as a parameter so
 * the seed can call it outside the Next.js server.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { DB } from "../../db";
import { buildings, departments, floors, liftCores, rooms } from "../../db/schema";
import { rectPoly, type Pt } from "../../components/assets/twin/geometry";
import { suggestLifts, type LiftFloor, type LiftSuggestion } from "./lifts";

export async function liftFloors(db: DB, facilityId: number): Promise<(LiftFloor & { name: string })[]> {
  const rows = await db.select({ id: floors.id, level: floors.level, name: floors.name, upm: floors.unitsPerMetre }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  return rows.map((f) => ({ id: f.id, level: f.level, name: f.name, unitsPerMetre: f.upm ?? 10 }));
}

export async function liftSuggestionsFor(db: DB, facilityId: number): Promise<LiftSuggestion[]> {
  const fl = await liftFloors(db, facilityId);
  if (fl.length < 2) return [];
  const rs = await db.select({ floorId: rooms.floorId, name: rooms.name, code: rooms.code, poly: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h, dept: departments.code })
    .from(rooms).leftJoin(departments, eq(departments.id, rooms.departmentId)).where(inArray(rooms.floorId, fl.map((f) => f.id)));
  return suggestLifts(fl, rs.map((r) => ({
    floorId: r.floorId, name: r.name, code: r.code, dept: r.dept,
    poly: (r.poly && r.poly.length >= 3 ? r.poly : rectPoly(r.x, r.y, r.w, r.h)) as Pt[],
  })));
}

/** Insert suggestions whose name the hospital doesn't have yet. Returns how many were added. */
export async function addLiftSuggestions(db: DB, facilityId: number): Promise<number> {
  const have = new Set((await db.select({ name: liftCores.name }).from(liftCores).where(eq(liftCores.facilityId, facilityId))).map((r) => r.name));
  const fresh = (await liftSuggestionsFor(db, facilityId)).filter((s) => !have.has(s.name));
  if (fresh.length) await db.insert(liftCores).values(fresh.map((s) => ({ facilityId, name: s.name, kind: s.kind, stops: s.stops, inferred: true, note: s.note })));
  return fresh.length;
}

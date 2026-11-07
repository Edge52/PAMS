/**
 * Drawing sources for hospitals loaded before wave 16 (run with the reference seed, every start; cheap when done):
 * rooms imported from a building file get where their outline came from, floors their alignment, matched by the
 * facility code, floor level and room code. Rooms of floors without a drawing count as drawn in the app.
 * Takes `db` so seeds can call it.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import type { DB } from "../../db";
import { buildings, facilities, floorCad, floors, rooms } from "../../db/schema";
import type { CadBuilding } from "./cad-rooms";

export async function backfillCadSources(d: DB, dir = path.resolve(process.cwd(), "seed-data/cad")): Promise<number> {
  const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(rooms).where(isNull(rooms.outlineSource));
  if (!n) return 0;
  let done = 0;
  // Rooms on floors with no drawing were drawn in the app.
  const handFloors = d.select({ id: floors.id }).from(floors).where(notExists(d.select({ x: floorCad.floorId }).from(floorCad).where(eq(floorCad.floorId, floors.id))));
  done += (await d.update(rooms).set({ outlineSource: "drawn" }).where(and(isNull(rooms.outlineSource), inArray(rooms.floorId, handFloors))).returning({ id: rooms.id })).length;
  if (!existsSync(dir)) return done;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let b: CadBuilding;
    try { b = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as CadBuilding; } catch { continue; }
    if (!b.facilityCode || !Array.isArray(b.floors)) continue;
    const [fac] = await d.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, b.facilityCode));
    if (!fac) continue;
    const fls = await d.select({ id: floors.id, level: floors.level }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, fac.id));
    for (const f of b.floors) {
      const fl = fls.find((x) => x.level === f.level); if (!fl) continue;
      if (f.alignment) await d.update(floorCad).set({ alignment: f.alignment }).where(and(eq(floorCad.floorId, fl.id), isNull(floorCad.alignment)));
      const byShape = new Map<string, string[]>();
      for (const r of f.rooms) (byShape.get(r.shape) ?? byShape.set(r.shape, []).get(r.shape)!).push(r.code.toUpperCase());
      for (const [shape, codes] of byShape) {
        done += (await d.update(rooms).set({ outlineSource: shape })
          .where(and(eq(rooms.floorId, fl.id), isNull(rooms.outlineSource), inArray(sql`upper(${rooms.code})`, codes))).returning({ id: rooms.id })).length;
      }
    }
  }
  return done;
}

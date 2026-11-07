import "server-only";
/** Drawing quality of one hospital (wave 16): its floors, drawing metadata and rooms, checked by drawing-quality.ts. */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, floorCad, floors, rooms } from "@/db/schema";
import { networkCoverage } from "@/lib/flows/route-server";
import { drawingQuality, type Pt, type QFloor } from "./drawing-quality";

const rectPoly = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export async function facilityDrawingQuality(facilityId: number, opts: { routes?: boolean } = {}) {
  const fl = await db.select({ id: floors.id, name: floors.name, level: floors.level, upm: floors.unitsPerMetre }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  const ids = fl.map((f) => f.id);
  if (!ids.length) return { floors: [] as QFloor[], reports: [] };
  // Segment counts without loading the linework itself.
  const cads = await db.select({
    floorId: floorCad.floorId, sourceFile: floorCad.sourceFile, revision: floorCad.revision, importedAt: floorCad.importedAt, alignment: floorCad.alignment,
    walls: sql<number>`coalesce(jsonb_array_length(${floorCad.walls}), 0) / 4`, doors: sql<number>`coalesce(jsonb_array_length(${floorCad.doors}), 0) / 4`,
    glass: sql<number>`coalesce(jsonb_array_length(${floorCad.glass}), 0) / 4`, columns: sql<number>`coalesce(jsonb_array_length(${floorCad.columns}), 0) / 4`,
  }).from(floorCad).where(inArray(floorCad.floorId, ids));
  const rs = await db.select({ id: rooms.id, floorId: rooms.floorId, code: rooms.code, name: rooms.name, type: rooms.type, polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h,
    outlineSource: rooms.outlineSource, verifiedAt: rooms.verifiedAt }).from(rooms).where(inArray(rooms.floorId, ids));
  // Rooms the walking network can't reach (built from the walls; cached per hospital).
  const unreachable = new Map<number, number[]>();
  if (opts.routes !== false) {
    try { for (const c of await networkCoverage(facilityId)) unreachable.set(c.floorId, c.unreachable.map((u) => u.id)); } catch { /* routes not available: that check is left out */ }
  }
  const qf: QFloor[] = fl.map((f) => {
    const c = cads.find((x) => x.floorId === f.id);
    return {
      id: f.id, name: f.name, level: f.level, unitsPerMetre: f.upm,
      cad: c ? { sourceFile: c.sourceFile, revision: c.revision, importedAt: c.importedAt.toISOString(), alignment: c.alignment ?? null,
        segments: { walls: Number(c.walls), doors: Number(c.doors), glass: Number(c.glass), columns: Number(c.columns) } } : null,
      rooms: rs.filter((r) => r.floorId === f.id).map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type,
        poly: r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h), outlineSource: r.outlineSource, verified: r.verifiedAt != null })),
      unreachable: unreachable.get(f.id) ?? null,
    };
  });
  return { floors: qf, reports: drawingQuality(qf) };
}

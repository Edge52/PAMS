import "server-only";
/** Clash and clearance checks (wave 17): one hospital's placed devices, rooms, doors and library zones, checked floor by floor. */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, deviceTypes, floorCad, floors, rooms } from "@/db/schema";
import { polygonArea, rectPoly } from "@/components/assets/twin/geometry";
import { deviceModel } from "@/components/assets/twin/render/device-models";
import { MODEL_SIZE } from "@/components/assets/twin/render/kits";
import { checkClashes, type ClashDevice, type ClashIssue } from "./clash";
import { sizesFor } from "./dimensions-server";
import { libraryFor } from "./equipment-library-server";

export type FloorClashes = { floorId: number; name: string; level: number; devices: number; placed: number; issues: (ClashIssue & { floorId: number })[] };

/** Door points of a floor (m): the midpoints of its door lines, one per 0.8 m, as the 3D view finds them. */
function doorPoints(segs: number[] | null, k: number): [number, number][] {
  const out: [number, number][] = [];
  if (!segs) return out;
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const p: [number, number] = [((segs[i] + segs[i + 2]) / 2) * k, ((segs[i + 1] + segs[i + 3]) / 2) * k];
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8)) out.push(p);
  }
  return out;
}

/**
 * Every floor's clashes. Devices placed on the plan get every check; devices only assigned to a room (spread out for
 * show in 3D) get the checks that need no position (see checkClashes).
 */
export async function facilityClashes(facilityId: number): Promise<{ floors: FloorClashes[]; names: Map<number, { tag: string; name: string; room: string | null }> }> {
  const fl = await db.select({ id: floors.id, name: floors.name, level: floors.level, upm: floors.unitsPerMetre }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  const ids = fl.map((f) => f.id);
  const names = new Map<number, { tag: string; name: string; room: string | null }>();
  if (!ids.length) return { floors: [], names };
  const rs = await db.select({ id: rooms.id, floorId: rooms.floorId, name: rooms.name, code: rooms.code, polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h, ceilingM: rooms.ceilingM, outlineSource: rooms.outlineSource })
    .from(rooms).where(inArray(rooms.floorId, ids));
  const devs = await db.select({ id: assets.id, tag: assets.assetTag, name: deviceTypes.name, typeCode: deviceTypes.code, roomId: assets.roomId, posX: assets.posX, posY: assets.posY,
    manufacturer: assets.manufacturer, model: assets.model }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, facilityId), isNotNull(assets.roomId), sql`${assets.status} <> 'DISPOSED'`));
  const cads = await db.select({ floorId: floorCad.floorId, doors: floorCad.doors }).from(floorCad).where(inArray(floorCad.floorId, ids));
  const sizes = await sizesFor({ assetIds: devs.map((d) => d.id) });
  const lib = await libraryFor(devs);
  const roomById = new Map(rs.map((r) => [r.id, r]));
  const out: FloorClashes[] = [];
  for (const f of fl) {
    const k = 1 / (f.upm ?? 10);
    const fr = rs.filter((r) => r.floorId === f.id);
    // Outlines guessed around a label, or under 2 m² (a label box, not a room: see Drawing quality), get no area checks.
    const cr = fr.map((r) => ({ id: r.id, name: `${r.name} ${r.code}`, ceilingM: r.ceilingM, guessed: r.outlineSource === "fallback" || polygonArea(r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)) * k * k < 2, poly: (r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)).map(([x, y]) => [x * k, y * k] as [number, number]) }));
    const cd: ClashDevice[] = devs.filter((d) => roomById.get(d.roomId!)?.floorId === f.id).map((d) => {
      const z = sizes.get(d.id), dims = z?.dims ?? { l: 0.6, w: 0.5, h: 1 }, key = lib.keyOf.get(d.id), e = key ? lib.library[key] : undefined;
      const ms = MODEL_SIZE[deviceModel(d.typeCode)] ?? { w: 1, d: 1 };
      names.set(d.id, { tag: d.tag, name: d.name, room: roomById.get(d.roomId!)?.name ?? null });
      const placed = d.posX != null && d.posY != null;
      return { id: d.id, tag: d.tag, name: d.name, typeCode: d.typeCode, roomId: d.roomId, x: (d.posX ?? 0) * k, z: (d.posY ?? 0) * k, placed,
        angle: z?.rot != null ? -z.rot * Math.PI / 180 : (d.id % 4) * Math.PI / 2, l: dims.l, w: dims.w, h: dims.h, longX: ms.w >= ms.d,
        zones: e?.zones ?? [], fringe: e?.fringe ?? null };
    });
    const doors = doorPoints(cads.find((c) => c.floorId === f.id)?.doors ?? null, k);
    out.push({ floorId: f.id, name: f.name, level: f.level, devices: cd.length, placed: cd.filter((d) => d.placed).length, issues: checkClashes(cr, cd, doors).map((i) => ({ ...i, floorId: f.id })) });
  }
  return { floors: out, names };
}

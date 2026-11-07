import "server-only";
/** Room standards (wave 14): the editable list or the built-in one, and a hospital's rooms checked against them. */
import { asc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, departments, drawingSymbols, floors, rooms, roomStandards } from "@/db/schema";
import { BUILTIN_STANDARDS, checkRoom, checkState, standardFor, type CheckRow, type StandardRule } from "./room-standards";

export async function loadStandards(): Promise<{ rules: StandardRule[]; custom: boolean }> {
  const rows = await db.select().from(roomStandards).orderBy(asc(roomStandards.sort), asc(roomStandards.id));
  if (!rows.length) return { rules: BUILTIN_STANDARDS, custom: false };
  return { custom: true, rules: rows.map((r) => ({ id: r.id, label: r.label, match: r.match, roomType: r.roomType, spec: r.spec, source: r.source })) };
}

/** Floor area of a room in m², from its outline or rectangle (plan units → metres). */
export function roomAreaM2(r: { polygon: [number, number][] | null; w: number; h: number }, unitsPerMetre: number | null): number {
  const k = unitsPerMetre ?? 10;
  const p = r.polygon && r.polygon.length >= 3 ? r.polygon : null;
  const a = p ? Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2) : r.w * r.h;
  return a / (k * k);
}

export type CheckedRoom = {
  id: number; code: string; name: string; type: string; floor: string; department: string | null; areaM2: number; beds: number;
  standardIndex: number | null; rows: CheckRow[]; state: ReturnType<typeof checkState>;
};

/** Every room of a hospital with the standard it follows and how it compares. */
export async function checkedRooms(facilityId: number, rules: StandardRule[]): Promise<CheckedRoom[]> {
  const rs = await db.select({ room: rooms, floor: floors.name, level: floors.level, upm: floors.unitsPerMetre, dept: departments.name })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .leftJoin(departments, eq(departments.id, rooms.departmentId))
    .where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level), asc(rooms.code));
  const gases = await drawingGasesFor(rs.map((x) => x.room.id));
  return rs.map(({ room: r, floor, upm, dept }) => {
    const m = standardFor(r.name, r.type, rules);
    const areaM2 = roomAreaM2(r, upm);
    const rows = m ? checkRoom(m.rule.spec, { areaM2, beds: r.beds, ceilingM: r.ceilingM, doorWidthM: r.doorWidthM, floorLoadKgM2: r.floorLoadKgM2, services: r.services, drawingGases: gases.get(r.id) }) : [];
    return { id: r.id, code: r.code, name: r.name, type: r.type, floor, department: dept, areaM2, beds: r.beds, standardIndex: m?.index ?? null, rows, state: m ? checkState(rows) : "none" };
  });
}

/** Gas outlets read from the drawing per room (wave 16): roomId → { O2: 2, VAC: 2, … } from symbols coded GAS-*. */
export async function drawingGasesFor(roomIds: number[]): Promise<Map<number, Record<string, number>>> {
  const out = new Map<number, Record<string, number>>();
  if (!roomIds.length) return out;
  const rows = await db.select({ roomId: drawingSymbols.roomId, code: drawingSymbols.code, n: sql<number>`count(*)::int` }).from(drawingSymbols)
    .where(sql`${inArray(drawingSymbols.roomId, roomIds)} and ${like(drawingSymbols.code, "GAS-%")}`).groupBy(drawingSymbols.roomId, drawingSymbols.code);
  for (const r of rows) {
    if (r.roomId == null || !r.code) continue;
    const m = out.get(r.roomId) ?? {}; m[r.code.slice(4)] = Number(r.n); out.set(r.roomId, m);
  }
  return out;
}

import "server-only";
/** Room standards (wave 14): the editable list or the built-in one, and a hospital's rooms checked against them. */
import { asc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, drawingSymbols, floors, rooms, roomStandards } from "@/db/schema";
import { BUILTIN_STANDARDS, checkRoom, checkState, roomWidthM, standardFor, type CheckRow, type StandardRule } from "./room-standards";

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

/** Narrowest width of a room in metres (wave 16), from its outline or rectangle. */
export function roomWidth(r: { polygon: [number, number][] | null; w: number; h: number }, unitsPerMetre: number | null): number {
  const k = unitsPerMetre ?? 10;
  const p = r.polygon && r.polygon.length >= 3 ? r.polygon : null;
  return (p ? roomWidthM(p) : Math.min(r.w, r.h)) / k;
}

/** Catalogue codes of the devices registered in each room, not disposed (wave 16): roomId → codes. */
export async function roomDevicesFor(roomIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  for (const id of roomIds) out.set(id, []);
  if (!roomIds.length) return out;
  const rows = await db.select({ roomId: assets.roomId, code: deviceTypes.code }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(sql`${inArray(assets.roomId, roomIds)} and ${assets.status} <> 'DISPOSED'`);
  for (const r of rows) if (r.roomId != null) out.get(r.roomId)?.push(r.code);
  return out;
}

export type CheckedRoom = {
  id: number; code: string; name: string; type: string; floor: string; department: string | null; areaM2: number; beds: number;
  standardIndex: number | null; standard: string | null; rows: CheckRow[]; state: ReturnType<typeof checkState>;
};

/** Every room of a hospital with the standard it follows and how it compares. */
export async function checkedRooms(facilityId: number, rules: StandardRule[]): Promise<CheckedRoom[]> {
  const rs = await db.select({ room: rooms, floor: floors.name, level: floors.level, upm: floors.unitsPerMetre, dept: departments.name })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .leftJoin(departments, eq(departments.id, rooms.departmentId))
    .where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level), asc(rooms.code));
  const ids = rs.map((x) => x.room.id);
  const gases = await drawingGasesFor(ids), devices = await roomDevicesFor(ids);
  return rs.map(({ room: r, floor, upm, dept }) => {
    const m = standardFor(r.name, r.type, rules);
    const areaM2 = roomAreaM2(r, upm);
    const rows = m ? checkRoom(m.rule.spec, { areaM2, beds: r.beds, ceilingM: r.ceilingM, doorWidthM: r.doorWidthM, floorLoadKgM2: r.floorLoadKgM2, services: r.services,
      drawingGases: gases.get(r.id), widthM: roomWidth(r, upm), devices: devices.get(r.id) ?? [] }) : [];
    return { id: r.id, code: r.code, name: r.name, type: r.type, floor, department: dept, areaM2, beds: r.beds, standardIndex: m?.index ?? null, standard: m?.rule.label ?? null, rows, state: m ? checkState(rows) : "none" };
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

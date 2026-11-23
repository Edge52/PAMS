import "server-only";
/** Database side of the MRI cryogen log (wave 38). Rules are pure in ./cryogen. */
import { and, asc, desc, eq, gte, inArray, like, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, cryogenReadings, departments, deviceTypes, mriMagnets, rooms } from "@/db/schema";
import { addDays } from "./dates";
import { cryoStatus, magnetSettings, type CryoReading, type CryoStatus, type MagnetSettings } from "./cryogen";
import { scopeWhere, type Scope } from "./access";

export type MagnetRow = {
  id: number; tag: string; facilityId: number; typeCode: string; typeName: string; model: string | null; manufacturer: string | null;
  departmentName: string | null; roomName: string | null; settings: MagnetSettings; ownSettings: boolean;
  readings: (CryoReading & { id: number; readBy: string; remarks: string | null })[]; status: CryoStatus;
};

/** MRI scanners (not disposed) in the scope or one hospital, with their recent readings and state. `days` of history. */
export async function mriMagnetRows(o: { scope: Scope; facilityId?: number; assetIds?: number[] }, today: string, days = 120): Promise<MagnetRow[]> {
  if (o.assetIds && !o.assetIds.length) return [];
  const list = await db.select({
    id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, typeCode: deviceTypes.code, typeName: deviceTypes.name, model: assets.model,
    manufacturer: assets.manufacturer, departmentName: departments.name, roomName: rooms.name, m: mriMagnets,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(mriMagnets, eq(mriMagnets.assetId, assets.id))
    .where(and(like(deviceTypes.code, "IMG-MRI%"), ne(assets.status, "DISPOSED"), scopeWhere(assets.facilityId, o.scope),
      o.facilityId ? eq(assets.facilityId, o.facilityId) : undefined, o.assetIds ? inArray(assets.id, o.assetIds) : undefined))
    .orderBy(asc(assets.assetTag));
  if (!list.length) return [];
  const since = addDays(today, -days);
  const rs = await db.select().from(cryogenReadings)
    .where(and(inArray(cryogenReadings.assetId, list.map((l) => l.id)), gte(cryogenReadings.readOn, since)))
    .orderBy(asc(cryogenReadings.readOn), asc(cryogenReadings.id));
  // A magnet read rarely still needs its latest reading (for "missing" and the level).
  const have = new Set(rs.map((r) => r.assetId));
  const older = list.filter((l) => !have.has(l.id)).map((l) => l.id);
  const lastOld = older.length ? await db.selectDistinctOn([cryogenReadings.assetId]).from(cryogenReadings).where(inArray(cryogenReadings.assetId, older))
    .orderBy(cryogenReadings.assetId, desc(cryogenReadings.readOn), desc(cryogenReadings.id)) : [];
  const by = new Map<number, typeof rs>();
  for (const r of [...lastOld, ...rs]) (by.get(r.assetId) ?? by.set(r.assetId, []).get(r.assetId)!).push(r);
  return list.map(({ m, ...l }) => {
    const settings = magnetSettings(m, l.typeCode);
    const readings = (by.get(l.id) ?? []).map((r) => ({ id: r.id, readOn: r.readOn, heliumPct: r.heliumPct, pressurePsi: r.pressurePsi, coldHead: r.coldHead,
      compressor: r.compressor, chillerTempC: r.chillerTempC, readBy: r.readBy, remarks: r.remarks }));
    return { ...l, settings, ownSettings: !!m, readings, status: cryoStatus(readings, settings, today) };
  });
}

import "server-only";
/** Database side of radiation safety records (wave 37). Rules are pure in ./radiation. */
import { and, asc, desc, eq, gte, inArray, isNotNull, like, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  assets, departments, deviceTypes, dosimetryPeriods, floors, protectiveChecks, protectiveItems, radiationLicences, radiationQcTests, rooms,
} from "@/db/schema";
import { addMonths } from "./dates";
import { checkState, isRadiationType, latestBy, licenceState, roomStatus, type CheckState, type ExpiryState, type RoomStatus } from "./radiation";

/** Devices in a hospital (or all, when facilityId is null) whose type uses ionising radiation, not disposed. */
export async function radiationDevices(facilityId: number | null, opts: { roomId?: number; assetIds?: number[] } = {}) {
  if (opts.assetIds && !opts.assetIds.length) return [];
  const rows = await db.select({
    id: assets.id, tag: assets.assetTag, status: assets.status, facilityId: assets.facilityId, roomId: assets.roomId, typeCode: deviceTypes.code, typeName: deviceTypes.name,
    model: assets.model, manufacturer: assets.manufacturer, departmentName: departments.name,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(facilityId ? eq(assets.facilityId, facilityId) : undefined, ne(assets.status, "DISPOSED"), or(like(deviceTypes.code, "IMG-%"), like(deviceTypes.code, "RTH-%")),
      opts.roomId ? eq(assets.roomId, opts.roomId) : undefined, opts.assetIds ? inArray(assets.id, opts.assetIds) : undefined))
    .orderBy(asc(assets.assetTag));
  return rows.filter((r) => isRadiationType(r.typeCode));
}

export type QcRow = typeof radiationQcTests.$inferSelect & { tag: string | null; roomName: string | null };
const qcKey = (q: { assetId: number | null; roomId: number | null; testName: string }) => `${q.assetId ? `a${q.assetId}` : `r${q.roomId}`}|${q.testName.trim().toLowerCase()}`;

/** Everything the radiation safety page needs for one hospital, with each item's state and each room's status. */
export async function radiationOverview(facilityId: number, today: string) {
  const yearAgo = addMonths(today, -12);
  const [devices, licences, qcAll, items, checks, doses] = await Promise.all([
    radiationDevices(facilityId),
    db.select({ l: radiationLicences, roomName: rooms.name, roomCode: rooms.code, tag: assets.assetTag }).from(radiationLicences)
      .leftJoin(rooms, eq(rooms.id, radiationLicences.roomId)).leftJoin(assets, eq(assets.id, radiationLicences.assetId))
      .where(and(eq(radiationLicences.facilityId, facilityId), eq(radiationLicences.active, true))).orderBy(asc(radiationLicences.expiresOn)),
    db.select({ q: radiationQcTests, tag: assets.assetTag, roomName: rooms.name }).from(radiationQcTests)
      .leftJoin(assets, eq(assets.id, radiationQcTests.assetId)).leftJoin(rooms, eq(rooms.id, radiationQcTests.roomId))
      .where(eq(radiationQcTests.facilityId, facilityId)).orderBy(desc(radiationQcTests.testedOn), desc(radiationQcTests.id)).limit(2000),
    db.select({ i: protectiveItems, roomName: rooms.name, departmentName: departments.name }).from(protectiveItems)
      .leftJoin(rooms, eq(rooms.id, protectiveItems.roomId)).leftJoin(departments, eq(departments.id, protectiveItems.departmentId))
      .where(and(eq(protectiveItems.facilityId, facilityId), eq(protectiveItems.active, true))).orderBy(asc(protectiveItems.label)),
    db.select({ c: protectiveChecks }).from(protectiveChecks).innerJoin(protectiveItems, eq(protectiveItems.id, protectiveChecks.itemId))
      .where(and(eq(protectiveItems.facilityId, facilityId), eq(protectiveItems.active, true))).orderBy(desc(protectiveChecks.checkedOn)),
    db.select({ d: dosimetryPeriods, departmentName: departments.name }).from(dosimetryPeriods).leftJoin(departments, eq(departments.id, dosimetryPeriods.departmentId))
      .where(and(eq(dosimetryPeriods.facilityId, facilityId), gte(dosimetryPeriods.periodEnd, yearAgo))).orderBy(desc(dosimetryPeriods.periodEnd), asc(dosimetryPeriods.personName)),
  ]);
  const lic = licences.map((r) => ({ ...r, state: licenceState(r.l.expiresOn, today) as ExpiryState }));
  const qcRows: QcRow[] = qcAll.map((r) => ({ ...r.q, tag: r.tag, roomName: r.roomName }));
  const qcLatest = [...latestBy(qcRows, qcKey, (r) => r.testedOn).values()].map((q) => ({ ...q, state: checkState(q, today) as CheckState }));
  const lastCheck = latestBy(checks.map((c) => c.c), (c) => String(c.itemId), (c) => c.checkedOn);
  const prot = items.map((r) => { const last = lastCheck.get(String(r.i.id)) ?? null; return { ...r, last, state: checkState(last, today) as CheckState }; });

  // Rooms: every room with a radiation device, a licence or protective equipment.
  const roomIds = new Set<number>();
  for (const d of devices) if (d.roomId) roomIds.add(d.roomId);
  for (const l of lic) if (l.l.roomId) roomIds.add(l.l.roomId);
  for (const p of prot) if (p.i.roomId) roomIds.add(p.i.roomId);
  for (const q of qcLatest) if (q.roomId) roomIds.add(q.roomId);
  const roomRows = roomIds.size ? await db.select({ id: rooms.id, code: rooms.code, name: rooms.name, floorName: floors.name, departmentName: departments.name })
    .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).leftJoin(departments, eq(departments.id, rooms.departmentId))
    .where(inArray(rooms.id, [...roomIds])).orderBy(asc(rooms.code)) : [];
  const deviceRoom = new Map(devices.map((d) => [d.id, d.roomId]));
  const roomOf = (assetId: number | null, roomId: number | null) => roomId ?? (assetId ? deviceRoom.get(assetId) ?? null : null);
  const roomsOut = roomRows.map((r) => {
    const devs = devices.filter((d) => d.roomId === r.id);
    const ls = lic.filter((l) => roomOf(l.l.assetId, l.l.roomId) === r.id);
    const qs = qcLatest.filter((q) => roomOf(q.assetId, q.roomId) === r.id);
    const ps = prot.filter((p) => p.i.roomId === r.id);
    const status: RoomStatus = roomStatus({ licences: ls.map((l) => l.state), qc: qs.map((q) => q.state), protective: ps.map((p) => p.state), radiationDevices: devs.length });
    return { ...r, devices: devs, licences: ls.length, status };
  });
  const order = { problem: 0, attention: 1, ok: 2 };
  roomsOut.sort((a, b) => order[a.status.state] - order[b.status.state] || a.code.localeCompare(b.code));
  return { devices, licences: lic, qc: qcLatest, qcHistory: qcRows, protective: prot, doses, rooms: roomsOut, unplaced: devices.filter((d) => !d.roomId) };
}

/** Radiation records that concern one device or one room (for the asset page and the room sheet). */
export async function radiationFor(o: { assetId?: number; roomId?: number | null }, today: string) {
  const byAsset = o.assetId ? eq(radiationLicences.assetId, o.assetId) : undefined;
  const byRoom = o.roomId ? eq(radiationLicences.roomId, o.roomId) : undefined;
  const [licences, qc] = await Promise.all([
    byAsset || byRoom ? db.select().from(radiationLicences).where(and(eq(radiationLicences.active, true), or(byAsset, byRoom))).orderBy(asc(radiationLicences.expiresOn)) : Promise.resolve([]),
    o.assetId || o.roomId ? db.select().from(radiationQcTests)
      .where(or(o.assetId ? eq(radiationQcTests.assetId, o.assetId) : undefined, o.roomId ? and(eq(radiationQcTests.roomId, o.roomId), isNotNull(radiationQcTests.roomId)) : undefined))
      .orderBy(desc(radiationQcTests.testedOn), desc(radiationQcTests.id)).limit(50) : Promise.resolve([]),
  ]);
  const latest = [...latestBy(qc, qcKey, (r) => r.testedOn).values()].map((q) => ({ ...q, state: checkState(q, today) }));
  return { licences: licences.map((l) => ({ ...l, state: licenceState(l.expiresOn, today) })), qc: latest };
}

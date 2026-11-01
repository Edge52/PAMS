import "server-only";
/**
 * Read models for the asset register, floor map, facility and catalogue pages.
 * Every list is one query (joins + group by) — no per-row lookups.
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  assets, buildings, departments, deviceTypes, facilities, floors, maintenanceEvents, poLines, rooms,
} from "@/db/schema";
import { todayISO } from "@/lib/format";
import { scopeWhere, type Scope } from "./access";
import { addDays } from "./dates";
import type { AssetFilter } from "./filters";

export const PAGE_SIZE = 50;

export const grp = alias(deviceTypes, "grp");
export const cat = alias(deviceTypes, "cat");

export { todayISO };

/* ── Locations ── */

/** Facilities the user may see (`scope` from facilityScope: null = all). */
export async function listFacilities(scope: Scope) {
  return db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities)
    .where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.code));
}

/** All buildings, floors, departments and rooms of one facility (or all in scope), for selects and pickers. 4 queries. */
export async function locationTree(facilityId: number | undefined, scope: Scope) {
  const fb = and(facilityId ? eq(buildings.facilityId, facilityId) : undefined, scopeWhere(buildings.facilityId, scope));
  const [b, f, d, r] = await Promise.all([
    db.select({ id: buildings.id, facilityId: buildings.facilityId, code: buildings.code, name: buildings.name }).from(buildings)
      .where(fb).orderBy(asc(buildings.code)),
    db.select({ id: floors.id, buildingId: floors.buildingId, level: floors.level, name: floors.name, buildingName: buildings.name, facilityId: buildings.facilityId })
      .from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(fb).orderBy(asc(buildings.code), asc(floors.level)),
    db.select({ id: departments.id, facilityId: departments.facilityId, code: departments.code, name: departments.name, nameAr: departments.nameAr })
      .from(departments).where(and(facilityId ? eq(departments.facilityId, facilityId) : undefined, scopeWhere(departments.facilityId, scope))).orderBy(asc(departments.name)),
    db.select({
      id: rooms.id, floorId: rooms.floorId, departmentId: rooms.departmentId, code: rooms.code, name: rooms.name, type: rooms.type, beds: rooms.beds,
      floorLevel: floors.level, floorName: floors.name, facilityId: buildings.facilityId,
    }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(fb).orderBy(asc(buildings.code), asc(floors.level), asc(rooms.code)),
  ]);
  return { buildings: b, floors: f, departments: d, rooms: r };
}
export type LocationTree = Awaited<ReturnType<typeof locationTree>>;

/** Level-3 device types with their group and category, sorted for grouped selects. */
export async function deviceTypeOptions() {
  return db.select({
    id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name,
    groupName: grp.name, categoryName: cat.name, categoryCode: cat.code,
  }).from(deviceTypes)
    .leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
    .where(and(eq(deviceTypes.level, 3), eq(deviceTypes.active, true)))
    .orderBy(asc(cat.code), asc(grp.code), asc(deviceTypes.name));
}
export type DeviceTypeOption = Awaited<ReturnType<typeof deviceTypeOptions>>[number];

export async function categoryOptions() {
  return db.select({ code: deviceTypes.code, name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes)
    .where(lte(deviceTypes.level, 2)).orderBy(asc(deviceTypes.code));
}

/* ── Asset register ── */

function assetWhere(f: AssetFilter, today: string, scope: Scope): SQL | undefined {
  const c: (SQL | undefined)[] = [scopeWhere(assets.facilityId, scope)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    c.push(or(ilike(assets.assetTag, like), ilike(assets.serialNumber, like), ilike(assets.model, like), ilike(assets.manufacturer, like), ilike(deviceTypes.name, like),
      sql`array_to_string(${assets.tags}, ' ') ilike ${like}`));
  }
  if (f.facilityId) c.push(eq(assets.facilityId, f.facilityId));
  if (f.buildingId) c.push(eq(floors.buildingId, f.buildingId));
  if (f.floorId) c.push(eq(rooms.floorId, f.floorId));
  if (f.departmentId) c.push(eq(assets.departmentId, f.departmentId));
  if (f.roomId) c.push(eq(assets.roomId, f.roomId));
  if (f.category) c.push(or(eq(cat.code, f.category), eq(grp.code, f.category)));
  if (f.deviceType) c.push(eq(deviceTypes.code, f.deviceType));
  if (f.status) c.push(eq(assets.status, f.status));
  if (f.criticality) c.push(eq(assets.criticality, f.criticality));
  if (f.warranty === "expired") c.push(lt(assets.warrantyEnd, today));
  if (f.warranty === "expiring") c.push(and(gte(assets.warrantyEnd, today), lte(assets.warrantyEnd, addDays(today, 90))));
  if (f.tag) c.push(sql`${f.tag} = any(${assets.tags})`);
  if (f.poId) c.push(inArray(assets.poLineId, db.select({ id: poLines.id }).from(poLines).where(eq(poLines.poId, f.poId))));
  const list = c.filter(Boolean) as SQL[];
  return list.length ? and(...list) : undefined;
}

const assetColumns = {
  id: assets.id, assetTag: assets.assetTag, status: assets.status, condition: assets.condition, criticality: assets.criticality,
  manufacturer: assets.manufacturer, model: assets.model, serialNumber: assets.serialNumber, tags: assets.tags,
  warrantyEnd: assets.warrantyEnd, installDate: assets.installDate, purchaseDate: assets.purchaseDate,
  purchaseCost: assets.purchaseCost, currency: assets.currency, poLineId: assets.poLineId,
  roomId: assets.roomId, departmentId: assets.departmentId, facilityId: assets.facilityId,
  deviceTypeCode: deviceTypes.code, deviceTypeName: deviceTypes.name, ppmIntervalMonths: deviceTypes.ppmIntervalMonths,
  categoryCode: cat.code, categoryName: cat.name,
  departmentName: departments.name, departmentCode: departments.code,
  roomCode: rooms.code, roomName: rooms.name, floorId: rooms.floorId, floorName: floors.name, floorLevel: floors.level,
  buildingName: buildings.name, facilityCode: facilities.code,
};

function assetBase() {
  return db.select(assetColumns).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
    .innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(rooms, eq(rooms.id, assets.roomId))
    .leftJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(buildings, eq(buildings.id, floors.buildingId));
}

function orderFor(f: AssetFilter) {
  switch (f.sort) {
    case "type": return [asc(deviceTypes.name), asc(assets.assetTag)];
    case "location": return [asc(floors.level), asc(rooms.code), asc(assets.assetTag)];
    case "warranty": return [sql`${assets.warrantyEnd} asc nulls last`, asc(assets.assetTag)];
    case "status": return [asc(assets.status), asc(assets.assetTag)];
    default: return [asc(assets.assetTag)];
  }
}

export async function searchAssets(f: AssetFilter, opts: { limit?: number; offset?: number }, scope: Scope) {
  const today = todayISO();
  const where = assetWhere(f, today, scope);
  const [rows, [{ n }]] = await Promise.all([
    assetBase().where(where).orderBy(...orderFor(f)).limit(opts.limit ?? PAGE_SIZE).offset(opts.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(assets)
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
      .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(floors, eq(floors.id, rooms.floorId))
      .where(where),
  ]);
  return { rows, total: n };
}
export type AssetRow = Awaited<ReturnType<typeof searchAssets>>["rows"][number];

export async function assetsByIds(ids: number[], scope: Scope) {
  if (!ids.length) return [];
  return assetBase().where(and(inArray(assets.id, ids), scopeWhere(assets.facilityId, scope))).orderBy(asc(assets.assetTag));
}

/** Last completed PPM and the earliest open PPM per asset, for a page of assets. One query. */
export async function ppmInfo(ids: number[]) {
  const out = new Map<number, { lastPpm: string | null; nextScheduled: string | null }>();
  if (!ids.length) return out;
  const rows = await db.select({
    assetId: maintenanceEvents.assetId,
    lastPpm: sql<string | null>`max(${maintenanceEvents.completedDate}) filter (where ${maintenanceEvents.status} = 'COMPLETED')`,
    nextScheduled: sql<string | null>`min(${maintenanceEvents.scheduledDate}) filter (where ${maintenanceEvents.status} in ('SCHEDULED','IN_PROGRESS','OVERDUE'))`,
  }).from(maintenanceEvents)
    .where(and(inArray(maintenanceEvents.assetId, ids), eq(maintenanceEvents.type, "PPM")))
    .groupBy(maintenanceEvents.assetId);
  for (const r of rows) out.set(r.assetId, { lastPpm: r.lastPpm, nextScheduled: r.nextScheduled });
  return out;
}

/* ── Floor map ── */

/** Floors of a facility with asset counts, for the floor switcher. One query. */
export async function floorsWithCounts(facilityId: number) {
  return db.select({
    id: floors.id, level: floors.level, name: floors.name, buildingId: buildings.id, buildingName: buildings.name, buildingCode: buildings.code,
    assetCount: sql<number>`count(${assets.id})::int`,
  }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .leftJoin(rooms, eq(rooms.floorId, floors.id))
    .leftJoin(assets, and(eq(assets.roomId, rooms.id), sql`${assets.status} <> 'DISPOSED'`))
    .where(eq(buildings.facilityId, facilityId))
    .groupBy(floors.id, buildings.id)
    .orderBy(asc(buildings.code), asc(floors.level));
}

/** Everything the floor map draws: floor, rooms (with departments) and the assets in those rooms. 3 queries + 1 count. */
export async function floorMapData(floorId: number) {
  const [floor] = await db.select({
    id: floors.id, level: floors.level, name: floors.name, planImageUrl: floors.planImageUrl, planWidth: floors.planWidth, planHeight: floors.planHeight,
    buildingId: buildings.id, buildingName: buildings.name, facilityId: facilities.id, facilityName: facilities.name, facilityCode: facilities.code,
  }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .where(eq(floors.id, floorId));
  if (!floor) return null;

  const [roomRows, assetRows] = await Promise.all([
    db.select({
      id: rooms.id, code: rooms.code, name: rooms.name, type: rooms.type, beds: rooms.beds, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h,
      polygon: rooms.polygon, departmentId: rooms.departmentId, departmentName: departments.name, departmentCode: departments.code, departmentNameAr: departments.nameAr,
    }).from(rooms).leftJoin(departments, eq(departments.id, rooms.departmentId)).where(eq(rooms.floorId, floorId)).orderBy(asc(rooms.code)),
    db.select({
      id: assets.id, tag: assets.assetTag, roomId: assets.roomId, departmentId: assets.departmentId, posX: assets.posX, posY: assets.posY,
      status: assets.status, condition: assets.condition, criticality: assets.criticality, manufacturer: assets.manufacturer, model: assets.model,
      serial: assets.serialNumber, warrantyEnd: assets.warrantyEnd,
      typeCode: deviceTypes.code, typeName: deviceTypes.name, categoryCode: cat.code, categoryName: cat.name,
    }).from(assets)
      .innerJoin(rooms, eq(rooms.id, assets.roomId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(grp, eq(grp.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, grp.parentId))
      .where(and(eq(rooms.floorId, floorId), sql`${assets.status} <> 'DISPOSED'`))
      .orderBy(asc(deviceTypes.code), asc(assets.assetTag)),
  ]);

  const deptIds = [...new Set(roomRows.map((r) => r.departmentId).filter((x): x is number => x != null))];
  const unplaced = deptIds.length
    ? await db.select({ departmentId: assets.departmentId, n: sql<number>`count(*)::int` }).from(assets)
      .where(and(inArray(assets.departmentId, deptIds), isNull(assets.roomId), sql`${assets.status} <> 'DISPOSED'`))
      .groupBy(assets.departmentId)
    : [];
  return { floor, rooms: roomRows, assets: assetRows, unplaced };
}
export type FloorMapData = NonNullable<Awaited<ReturnType<typeof floorMapData>>>;

/** Rooms of a floor + the asset rows needed for a static mini map. */
export async function miniMapData(floorId: number) {
  const [floor] = await db.select({ id: floors.id, planWidth: floors.planWidth, planHeight: floors.planHeight, planImageUrl: floors.planImageUrl })
    .from(floors).where(eq(floors.id, floorId));
  if (!floor) return null;
  const [roomRows, assetRows] = await Promise.all([
    db.select({ id: rooms.id, code: rooms.code, name: rooms.name, type: rooms.type, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h, departmentId: rooms.departmentId })
      .from(rooms).where(eq(rooms.floorId, floorId)),
    db.select({ id: assets.id, roomId: assets.roomId, posX: assets.posX, posY: assets.posY, typeCode: deviceTypes.code, tag: assets.assetTag })
      .from(assets).innerJoin(rooms, eq(rooms.id, assets.roomId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(rooms.floorId, floorId), sql`${assets.status} <> 'DISPOSED'`)),
  ]);
  return { floor, rooms: roomRows, assets: assetRows };
}

/** Asset counts per status for a facility (or all). */
export async function statusCounts(facilityId: number | undefined, scope: Scope) {
  return db.select({ status: assets.status, n: sql<number>`count(*)::int` }).from(assets)
    .where(and(facilityId ? eq(assets.facilityId, facilityId) : undefined, scopeWhere(assets.facilityId, scope))).groupBy(assets.status).orderBy(desc(sql`count(*)`));
}

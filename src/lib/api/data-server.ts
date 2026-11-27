import "server-only";
/** The read-only API's data (wave 41). Bounded pages, the token's hospitals only, money only with prices:read. */
import { and, asc, count, eq, gte, inArray, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, maintenanceEvents, rooms, workOrders } from "@/db/schema";
import { ASSET_STATUSES, MAINTENANCE_STATUSES } from "@/lib/assets/filters";
import { todayISO } from "@/lib/format";
import { ApiInputError, type ApiCtx } from "./api-server";
import { pageOf, paging, sinceParam, withoutPrices } from "./tokens";

const inScope = (col: Parameters<typeof inArray>[0], scope: number[] | null): SQL | undefined =>
  scope === null ? undefined : scope.length ? inArray(col, scope) : sql`false`;

function oneOfParam<T extends string>(v: string | null, list: readonly T[], name: string): T | null {
  if (!v) return null;
  const k = v.toUpperCase();
  if (!(list as readonly string[]).includes(k)) throw new ApiInputError(`?${name}= must be one of ${list.join(", ")}.`);
  return k as T;
}
function since(ctx: ApiCtx) {
  const v = ctx.sp.get("updatedSince");
  const d = sinceParam(v);
  if (v && !d) throw new ApiInputError("?updatedSince= must be a date (YYYY-MM-DD) or a date-time.");
  return d;
}

export async function apiAssets(ctx: ApiCtx) {
  const p = paging(ctx.sp);
  const status = oneOfParam(ctx.sp.get("status"), ASSET_STATUSES, "status");
  const d = since(ctx);
  const where = and(inScope(assets.facilityId, ctx.scope), status ? eq(assets.status, status) : undefined, d ? gte(assets.updatedAt, d) : undefined);
  const [rows, [{ n }]] = await Promise.all([
    db.select({
      id: assets.id, tag: assets.assetTag, facility: facilities.code, deviceTypeCode: deviceTypes.code, deviceType: deviceTypes.name,
      manufacturer: assets.manufacturer, model: assets.model, serialNumber: assets.serialNumber, udiDi: assets.udiDi,
      status: assets.status, condition: assets.condition, criticality: assets.criticality, department: departments.name, room: rooms.code,
      purchaseDate: assets.purchaseDate, installDate: assets.installDate, warrantyEnd: assets.warrantyEnd,
      purchaseCost: assets.purchaseCost, currency: assets.currency, updatedAt: assets.updatedAt,
    }).from(assets).innerJoin(facilities, eq(facilities.id, assets.facilityId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
      .where(where).orderBy(asc(assets.id)).limit(p.perPage).offset(p.offset),
    db.select({ n: count() }).from(assets).where(where),
  ]);
  return { body: pageOf(withoutPrices(rows, ["purchaseCost", "currency"], ctx.prices), Number(n), p), rows: rows.length };
}

const WO_STATUSES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"] as const;

export async function apiWorkOrders(ctx: ApiCtx) {
  const p = paging(ctx.sp);
  const status = oneOfParam(ctx.sp.get("status"), WO_STATUSES, "status");
  const d = since(ctx);
  const open = ctx.sp.get("open") === "1";
  const where = and(inScope(workOrders.facilityId, ctx.scope), status ? eq(workOrders.status, status) : undefined,
    open ? notInArray(workOrders.status, ["COMPLETED", "CLOSED", "CANCELLED"]) : undefined, d ? gte(workOrders.updatedAt, d) : undefined);
  const [rows, [{ n }]] = await Promise.all([
    db.select({
      id: workOrders.id, number: workOrders.number, facility: facilities.code, assetTag: assets.assetTag, type: workOrders.type, priority: workOrders.priority,
      status: workOrders.status, title: workOrders.title, deviceDown: workOrders.deviceDown, reportedAt: workOrders.reportedAt, dueAt: workOrders.dueAt,
      startedAt: workOrders.startedAt, completedAt: workOrders.completedAt, closedAt: workOrders.closedAt, failureCode: workOrders.failureCode,
      coverage: workOrders.coverage, laborHours: workOrders.laborHours, cost: workOrders.cost, currency: workOrders.currency, updatedAt: workOrders.updatedAt,
    }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(facilities, eq(facilities.id, workOrders.facilityId))
      .where(where).orderBy(asc(workOrders.id)).limit(p.perPage).offset(p.offset),
    db.select({ n: count() }).from(workOrders).where(where),
  ]);
  return { body: pageOf(withoutPrices(rows, ["cost", "currency"], ctx.prices), Number(n), p), rows: rows.length };
}

export async function apiPpm(ctx: ApiCtx) {
  const p = paging(ctx.sp);
  const status = oneOfParam(ctx.sp.get("status"), MAINTENANCE_STATUSES, "status");
  const from = ctx.sp.get("from"), to = ctx.sp.get("to");
  for (const [k, v] of [["from", from], ["to", to]] as const) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ApiInputError(`?${k}= must be a date (YYYY-MM-DD).`);
  const where = and(inScope(assets.facilityId, ctx.scope), ne(maintenanceEvents.type, "CORRECTIVE"), status ? eq(maintenanceEvents.status, status) : undefined,
    from ? gte(sql`coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate})`, from) : undefined,
    to ? lt(sql`coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate})`, sql`${to}::date + 1`) : undefined);
  const [rows, [{ n }]] = await Promise.all([
    db.select({
      id: maintenanceEvents.id, facility: facilities.code, assetTag: assets.assetTag, type: maintenanceEvents.type, status: maintenanceEvents.status,
      scheduledDate: maintenanceEvents.scheduledDate, completedDate: maintenanceEvents.completedDate, performedBy: maintenanceEvents.performedBy,
      downtimeHours: maintenanceEvents.downtimeHours, cost: maintenanceEvents.cost, currency: maintenanceEvents.currency,
    }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
      .where(where).orderBy(asc(maintenanceEvents.id)).limit(p.perPage).offset(p.offset),
    db.select({ n: count() }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).where(where),
  ]);
  return { body: pageOf(withoutPrices(rows, ["cost", "currency"], ctx.prices), Number(n), p), rows: rows.length };
}

/** Key figures per hospital: devices, out of service, open jobs, PPM overdue and done on time in the last 90 days. */
export async function apiKpis(ctx: ApiCtx) {
  const today = todayISO();
  const facs = await db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities).where(inScope(facilities.id, ctx.scope)).orderBy(asc(facilities.code)).limit(200);
  if (!facs.length) return { body: { asOf: today, data: [] }, rows: 0 };
  const ids = facs.map((f) => f.id);
  const [dev, jobs, ppm] = await Promise.all([
    db.select({ f: assets.facilityId, total: sql<number>`count(*) filter (where ${assets.status} <> 'DISPOSED')::int`,
      down: sql<number>`count(*) filter (where ${assets.status} in ('OUT_OF_SERVICE', 'UNDER_MAINTENANCE'))::int` })
      .from(assets).where(inArray(assets.facilityId, ids)).groupBy(assets.facilityId),
    db.select({ f: workOrders.facilityId, open: sql<number>`count(*)::int`, down: sql<number>`count(*) filter (where ${workOrders.deviceDown})::int`,
      late: sql<number>`count(*) filter (where ${workOrders.dueAt} < now() and ${workOrders.startedAt} is null)::int` })
      .from(workOrders).where(and(inArray(workOrders.facilityId, ids), notInArray(workOrders.status, ["COMPLETED", "CLOSED", "CANCELLED"]))).groupBy(workOrders.facilityId),
    db.select({ f: assets.facilityId,
      overdue: sql<number>`count(*) filter (where ${maintenanceEvents.status} in ('SCHEDULED', 'OVERDUE') and ${maintenanceEvents.scheduledDate} < ${today})::int`,
      done90: sql<number>`count(*) filter (where ${maintenanceEvents.status} = 'COMPLETED' and ${maintenanceEvents.completedDate} >= ${today}::date - 90)::int`,
      onTime90: sql<number>`count(*) filter (where ${maintenanceEvents.status} = 'COMPLETED' and ${maintenanceEvents.completedDate} >= ${today}::date - 90 and (${maintenanceEvents.scheduledDate} is null or ${maintenanceEvents.completedDate} <= ${maintenanceEvents.scheduledDate} + 7))::int` })
      .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(inArray(assets.facilityId, ids), eq(maintenanceEvents.type, "PPM"))).groupBy(assets.facilityId),
  ]);
  const data = facs.map((f) => {
    const d = dev.find((x) => x.f === f.id), j = jobs.find((x) => x.f === f.id), m = ppm.find((x) => x.f === f.id);
    const done = Number(m?.done90 ?? 0);
    return {
      facility: f.code, name: f.name, devices: Number(d?.total ?? 0), devicesDown: Number(d?.down ?? 0),
      openWorkOrders: Number(j?.open ?? 0), openWithDeviceDown: Number(j?.down ?? 0), responseOverdue: Number(j?.late ?? 0),
      ppmOverdue: Number(m?.overdue ?? 0), ppmDone90d: done, ppmOnTimePct90d: done ? Math.round((1000 * Number(m?.onTime90 ?? 0)) / done) / 10 : null,
    };
  });
  return { body: { asOf: today, onTimeRule: "completed within 7 days of the due date", data }, rows: data.length };
}

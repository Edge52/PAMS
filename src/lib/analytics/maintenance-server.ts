import "server-only";
/**
 * Loads what Analytics › Maintenance (and the Overview) work from (wave 40): devices in the filters, their downtime,
 * jobs and planned visits in the period. Bounded queries; the sums are in `maintenance.ts`.
 */
import { and, asc, eq, gte, isNotNull, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, maintenanceEvents, workOrders } from "@/db/schema";
import type { Filters } from "./core";
import { inScope } from "./scope-server";
import { periodMs, type Downtime, type Job, type PpmVisit, type UptimeDevice } from "./maintenance";

const MAX_DEVICES = 20_000;
const MAX_ROWS = 50_000;

/** Devices matching the filters (hospital scope, department, device type). */
export function deviceCond(f: Filters, ids: number[]): SQL {
  return and(
    inScope(assets.facilityId, ids),
    f.departmentId ? eq(assets.departmentId, f.departmentId) : undefined,
    f.deviceTypeId ? eq(assets.deviceTypeId, f.deviceTypeId) : undefined,
  )!;
}

export type MaintenanceData = {
  devices: (UptimeDevice & { tag: string })[];
  downtime: Downtime[];
  jobs: Job[];
  visits: PpmVisit[];
  /** True when a list hit its limit (the figures then rest on part of the data). */
  cut: boolean;
};

export async function loadMaintenanceData(f: Filters, ids: number[]): Promise<MaintenanceData> {
  const w = periodMs(f);
  const start = new Date(w.start), end = new Date(w.end);
  const cond = deviceCond(f, ids);
  const disposedOn = sql<string | null>`(select max(d.disposed_on)::text from disposals d where d.asset_id = ${assets.id} and d.disposed_on is not null)`;
  const [devRows, down, jobs, visits] = await Promise.all([
    db.select({
      id: assets.id, tag: assets.assetTag, status: assets.status, typeId: deviceTypes.id, typeLabel: deviceTypes.name, typeCode: deviceTypes.code,
      departmentId: assets.departmentId, departmentLabel: departments.name, installedOn: assets.installDate, leftOn: disposedOn,
    }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(departments, eq(departments.id, assets.departmentId))
      .where(and(cond, ne(assets.status, "IN_STOCK"))).orderBy(asc(assets.id)).limit(MAX_DEVICES),
    db.select({ assetId: workOrders.assetId, start: workOrders.downtimeStart, end: workOrders.downtimeEnd })
      .from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(cond, eq(workOrders.deviceDown, true), ne(workOrders.status, "CANCELLED"), isNotNull(workOrders.downtimeStart),
        lt(workOrders.downtimeStart, end), or(isNull(workOrders.downtimeEnd), gte(workOrders.downtimeEnd, start))))
      .limit(MAX_ROWS),
    db.select({
      id: workOrders.id, assetId: workOrders.assetId, type: workOrders.type, status: workOrders.status, reportedAt: workOrders.reportedAt,
      completedAt: workOrders.completedAt, failureCode: workOrders.failureCode, deviceDown: workOrders.deviceDown,
      downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd,
    }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(cond, eq(workOrders.type, "CORRECTIVE"), ne(workOrders.status, "CANCELLED"),
        or(and(gte(workOrders.reportedAt, start), lt(workOrders.reportedAt, end)), and(gte(workOrders.completedAt, start), lt(workOrders.completedAt, end)))))
      .limit(MAX_ROWS),
    // Planned visits scheduled or done in the period; a fault was found when the visit's job had a failed check or a
    // failure code other than "no problem found".
    db.select({
      status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate, completedDate: maintenanceEvents.completedDate,
      faultFound: sql<boolean>`exists (select 1 from work_orders w where (w.maintenance_event_id = ${maintenanceEvents.id} or w.planned_event_id = ${maintenanceEvents.id})
        and ((w.failure_code is not null and w.failure_code <> 'NO_PROBLEM_FOUND')
          or exists (select 1 from jsonb_array_elements(coalesce(w.checklist, '[]'::jsonb)) c where c->>'result' = 'FAIL')))`,
    }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(cond, eq(maintenanceEvents.type, "PPM"), or(
        and(gte(maintenanceEvents.scheduledDate, f.from), sql`${maintenanceEvents.scheduledDate} <= ${f.to}`),
        and(gte(maintenanceEvents.completedDate, f.from), sql`${maintenanceEvents.completedDate} <= ${f.to}`))))
      .limit(MAX_ROWS),
  ]);
  const devices = devRows
    .filter((d) => d.status !== "DISPOSED" || (d.leftOn != null && d.leftOn >= f.from))
    .map((d) => ({
      id: d.id, tag: d.tag, typeId: d.typeId, typeLabel: d.typeLabel, departmentId: d.departmentId, departmentLabel: d.departmentLabel ?? "No department",
      imaging: d.typeCode.toUpperCase().startsWith("IMG-"), installedOn: d.installedOn, leftOn: d.leftOn,
    }));
  return {
    devices,
    downtime: down.filter((r): r is { assetId: number; start: Date; end: Date | null } => r.start != null),
    jobs, visits: visits.map((v) => ({ ...v, faultFound: !!v.faultFound })),
    cut: devRows.length >= MAX_DEVICES || down.length >= MAX_ROWS || jobs.length >= MAX_ROWS || visits.length >= MAX_ROWS,
  };
}

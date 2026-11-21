import "server-only";
/**
 * Live metrics for the 3D view: status and trouble indicators for every placed device of one hospital, computed with a
 * handful of grouped queries. Used by the 3D page (first paint) and /assets/3d/live (refresh every minute).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, maintenanceEvents, recallAssets, recalls, workOrders } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import type { LivePayload, LiveRow } from "@/components/assets/twin/types";
import { downtimeMsByDevice } from "./downtime";
import { egpRates } from "./lifecycle-server";

export async function twinLive(facilityId: number): Promise<LivePayload> {
  const today = todayISO();
  const rows = await db.select({
    id: assets.id, status: assets.status, cost: assets.purchaseCost, currency: assets.currency,
    beyond: sql<boolean>`coalesce(${assets.installDate}, ${assets.purchaseDate}) + make_interval(years => coalesce(${assets.lifeExpectancyYears}, ${deviceTypes.lifeExpectancyYears}, 1000)) < ${today}::date`,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, facilityId), sql`${assets.status} <> 'DISPOSED'`, sql`${assets.roomId} is not null`));
  if (!rows.length) return { at: new Date().toISOString(), rows: [] };
  const inFacility = sql`${sql.raw('"asset_id"')} in (select id from assets where facility_id = ${facilityId})`;
  const [jobs, overdue, down, recalled, rates] = await Promise.all([
    db.select({ id: workOrders.assetId, n: sql<number>`count(*)::int` }).from(workOrders)
      .where(and(eq(workOrders.facilityId, facilityId), inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]))).groupBy(workOrders.assetId),
    db.selectDistinct({ id: maintenanceEvents.assetId }).from(maintenanceEvents)
      .where(and(inArray(maintenanceEvents.status, ["SCHEDULED", "IN_PROGRESS", "OVERDUE"]), sql`${maintenanceEvents.scheduledDate} < ${today}`, inFacility)),
    // Downtime periods of the last year, merged per device below so two jobs on one outage count it once (audit A2).
    db.select({ device: workOrders.assetId, start: workOrders.downtimeStart, end: workOrders.downtimeEnd }).from(workOrders)
      .where(and(eq(workOrders.facilityId, facilityId), sql`${workOrders.downtimeStart} is not null`, sql`${workOrders.status} <> 'CANCELLED'`,
        sql`coalesce(${workOrders.downtimeEnd}, now()) > now() - interval '365 days'`)),
    db.selectDistinct({ id: recallAssets.assetId }).from(recallAssets).innerJoin(recalls, eq(recalls.id, recallAssets.recallId))
      .where(and(eq(recallAssets.status, "PENDING"), eq(recalls.status, "OPEN"), inFacility)),
    egpRates(),
  ]);
  const jobsBy = new Map(jobs.map((r) => [r.id, Number(r.n)]));
  const overdueSet = new Set(overdue.map((r) => r.id));
  const nowD = new Date();
  const downBy = new Map([...downtimeMsByDevice(down.map((r) => ({ device: r.device, start: r.start!, end: r.end })), new Date(nowD.getTime() - 365 * 86_400_000), nowD)]
    .map(([id, ms]) => [id, ms / 3_600_000]));
  const recallSet = new Set(recalled.map((r) => r.id));
  return {
    at: new Date().toISOString(),
    rows: rows.map((r): LiveRow => {
      const rate = rates.get(r.currency ?? "EGP");
      const value = r.cost != null && rate != null ? Math.round(num(r.cost) * rate) : 0;
      return [r.id, r.status, jobsBy.get(r.id) ?? 0, overdueSet.has(r.id) ? 1 : 0, r.beyond ? 1 : 0, Math.round((downBy.get(r.id) ?? 0) * 10) / 10, value, recallSet.has(r.id) ? 1 : 0];
    }),
  };
}

import "server-only";
import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, deliveries, deviceTypes, exchangeRates, invoices, maintenanceEvents, offers, projects, purchaseOrders, serviceContractAssets, serviceContracts, workOrders } from "@/db/schema";
import { addDaysISO } from "@/lib/format";
import type { DqData } from "@/lib/data-quality";

/** Most rows read per list; a note says so when a list is cut. */
export const DQ_LIMIT = 20000;

function cond(col: PgColumn, facilityId: number | null, scope: number[] | null, nullable = false): SQL | undefined {
  if (facilityId) return eq(col, facilityId);
  if (scope === null) return undefined;
  if (!scope.length) return nullable ? sql`${col} is null` : sql`false`;
  return nullable ? or(inArray(col, scope), sql`${col} is null`) : inArray(col, scope);
}

/**
 * Rows for the data quality rules, bounded: devices, finished jobs of the last year and every open job, orders,
 * offers of the last two years, contracts that ended in the last two years. `prices` = may see offers and invoices.
 */
export async function loadDqData(facilityId: number | null, scope: number[] | null, today: string, prices: boolean): Promise<{ data: DqData; cut: string[] }> {
  const yearAgo = new Date(`${addDaysISO(today, -365)}T00:00:00Z`);
  const twoYears = addDaysISO(today, -730);
  const ppmPlanned = sql<boolean>`exists (select 1 from ${maintenanceEvents} me where me.asset_id = ${assets.id} and me.type = 'PPM' and me.status in ('SCHEDULED','IN_PROGRESS','OVERDUE'))`;
  const lastPpm = sql<string | null>`(select max(me.completed_date)::text from ${maintenanceEvents} me where me.asset_id = ${assets.id} and me.type = 'PPM' and me.status = 'COMPLETED')`;
  const openJob = sql<boolean>`exists (select 1 from ${workOrders} w where w.asset_id = ${assets.id} and w.status in ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD'))`;

  const [assetRows, jobRows, poRows, offerRows, contractRows, rates] = await Promise.all([
    db.select({
      id: assets.id, facilityId: assets.facilityId, tag: assets.assetTag, status: assets.status, condition: assets.condition,
      serial: assets.serialNumber, manufacturer: assets.manufacturer, model: assets.model, installDate: assets.installDate,
      purchaseDate: assets.purchaseDate, purchaseCost: assets.purchaseCost, roomId: assets.roomId,
      criticality: sql<string | null>`coalesce(${assets.criticality}, ${deviceTypes.criticality})::text`, gmdnCode: deviceTypes.gmdnCode,
      ppmIntervalMonths: deviceTypes.ppmIntervalMonths, strategy: deviceTypes.maintenanceStrategy, lastPpm, ppmPlanned, openJob,
    }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(cond(assets.facilityId, facilityId, scope), sql`${assets.status} <> 'DISPOSED'`)).orderBy(assets.id).limit(DQ_LIMIT + 1),
    db.select({
      id: workOrders.id, facilityId: workOrders.facilityId, number: workOrders.number, status: workOrders.status,
      reportedAt: sql<string>`${workOrders.reportedAt}::text`, laborHours: workOrders.laborHours, deviceDown: workOrders.deviceDown,
      downtimeStart: sql<string | null>`${workOrders.downtimeStart}::text`, downtimeEnd: sql<string | null>`${workOrders.downtimeEnd}::text`,
    }).from(workOrders)
      .where(and(cond(workOrders.facilityId, facilityId, scope), or(inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]),
        and(inArray(workOrders.status, ["COMPLETED", "CLOSED"]), gte(workOrders.completedAt, yearAgo)))))
      .orderBy(workOrders.id).limit(DQ_LIMIT + 1),
    prices ? db.select({
      id: purchaseOrders.id, facilityId: purchaseOrders.facilityId, number: purchaseOrders.number, status: purchaseOrders.status,
      lastDelivery: sql<string | null>`(select max(d.delivery_date)::text from ${deliveries} d where d.po_id = ${purchaseOrders.id})`,
      invoiced: sql<boolean>`exists (select 1 from ${invoices} i where i.po_id = ${purchaseOrders.id} and i.status <> 'REJECTED')`,
    }).from(purchaseOrders)
      .where(and(cond(purchaseOrders.facilityId, facilityId, scope, true), inArray(purchaseOrders.status, ["PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"])))
      .orderBy(purchaseOrders.id).limit(DQ_LIMIT + 1) : Promise.resolve([]),
    prices ? db.select({ id: offers.id, facilityId: projects.facilityId, reference: offers.reference, currency: offers.currency, status: offers.status })
      .from(offers).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(cond(projects.facilityId, facilityId, scope, true), gte(offers.offerDate, twoYears))).orderBy(offers.id).limit(DQ_LIMIT + 1) : Promise.resolve([]),
    db.select({
      id: serviceContracts.id, facilityId: serviceContracts.facilityId, number: serviceContracts.number, endDate: serviceContracts.endDate,
      assetIds: sql<number[]>`coalesce((select array_agg(ca.asset_id) from ${serviceContractAssets} ca where ca.contract_id = ${serviceContracts.id}), '{}')`,
    }).from(serviceContracts)
      .where(and(cond(serviceContracts.facilityId, facilityId, scope), gte(serviceContracts.endDate, twoYears))).orderBy(serviceContracts.id).limit(DQ_LIMIT + 1),
    db.selectDistinct({ currency: exchangeRates.currency }).from(exchangeRates),
  ]);
  const running = await db.select({ assetId: serviceContractAssets.assetId }).from(serviceContractAssets)
    .innerJoin(serviceContracts, eq(serviceContracts.id, serviceContractAssets.contractId))
    .where(and(cond(serviceContracts.facilityId, facilityId, scope), sql`${serviceContracts.startDate} <= ${today}::date and ${serviceContracts.endDate} >= ${today}::date`));

  const cut: string[] = [];
  const cap = <T,>(rows: T[], what: string): T[] => {
    if (rows.length > DQ_LIMIT) { cut.push(what); return rows.slice(0, DQ_LIMIT); }
    return rows;
  };
  return {
    data: {
      assets: cap(assetRows, "devices"),
      workOrders: cap(jobRows, "work orders"),
      pos: cap(poRows, "orders"),
      offers: cap(offerRows, "offers"),
      contracts: cap(contractRows.map((c) => ({ ...c, assetIds: (c.assetIds ?? []).map(Number) })), "contracts"),
      rated: new Set(rates.map((r) => r.currency)),
      coveredNow: new Set(running.map((r) => r.assetId)),
    },
    cut,
  };
}

import "server-only";
/**
 * Analytics › Compare hospitals, database side (wave 40): one grouped query per figure, all hospitals at once.
 * Money is read only when `prices` is true, converted to EGP with lib/fx at the date that fixes each amount.
 */
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, facilities, invoiceLines, invoices, maintenanceEvents, purchaseOrders, serviceContractAssets, serviceContracts, workOrders } from "@/db/schema";
import { downtimeMsByDevice } from "@/lib/assets/downtime";
import { DEFAULT_PPM_GRACE_DAYS } from "@/lib/reports/calc";
import { contractShare } from "@/lib/reports/service-cost-calc";
import { loadFx } from "@/lib/server-utils";
import { periodDays, type Filters } from "./core";
import { hospitalKpis, type HospitalIn } from "./compare";

const OPEN = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;

export async function compareHospitals(ids: number[], f: Filters, today: string, prices: boolean) {
  if (!ids.length) return [];
  const dev = and(inArray(assets.facilityId, ids), f.departmentId ? eq(assets.departmentId, f.departmentId) : undefined, f.deviceTypeId ? eq(assets.deviceTypeId, f.deviceTypeId) : undefined);
  const inUse = sql`${assets.status} not in ('DISPOSED', 'IN_STOCK')`;
  const grace = DEFAULT_PPM_GRACE_DAYS;
  const from = new Date(`${f.from}T00:00:00Z`), toEnd = new Date(Math.min(Date.parse(`${f.to}T00:00:00Z`) + 86_400_000, Date.now()));
  const [facs, devices, ppm, open, down] = await Promise.all([
    db.select({ id: facilities.id, name: facilities.name, beds: facilities.totalBeds }).from(facilities).where(inArray(facilities.id, ids)).orderBy(facilities.code),
    db.select({ facilityId: assets.facilityId, n: sql<number>`count(*)::int` }).from(assets).where(and(dev, inUse)).groupBy(assets.facilityId),
    // Same rule as the PPM compliance report: on time = done by the scheduled date + grace days; not yet due left out.
    db.select({
      facilityId: assets.facilityId,
      onTime: sql<number>`count(*) filter (where ${maintenanceEvents.status} = 'COMPLETED' and coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate}) <= ${maintenanceEvents.scheduledDate} + ${grace}::int)::int`,
      due: sql<number>`count(*) filter (where ${maintenanceEvents.status} = 'COMPLETED' or ${today}::date > ${maintenanceEvents.scheduledDate} + ${grace}::int)::int`,
    }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(dev, eq(maintenanceEvents.type, "PPM"), sql`${maintenanceEvents.status} <> 'CANCELLED'`, gte(maintenanceEvents.scheduledDate, f.from), lte(maintenanceEvents.scheduledDate, f.to)))
      .groupBy(assets.facilityId),
    db.select({ facilityId: assets.facilityId, n: sql<number>`count(*)::int` }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(dev, inArray(workOrders.status, [...OPEN]))).groupBy(assets.facilityId),
    // TODO(wave 40): use the uptime from src/lib/analytics/maintenance.ts (agent E) once it is merged, so both tabs agree.
    db.select({ device: workOrders.assetId, facilityId: assets.facilityId, start: workOrders.downtimeStart, end: workOrders.downtimeEnd }).from(workOrders)
      .innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(dev, isNotNull(workOrders.downtimeStart), sql`${workOrders.status} <> 'CANCELLED'`, sql`${workOrders.downtimeStart} < ${toEnd.toISOString()}::timestamptz`,
        sql`coalesce(${workOrders.downtimeEnd}, now()) > ${from.toISOString()}::timestamptz`)).limit(20_000),
  ]);
  const downMs = downtimeMsByDevice(down.map((d) => ({ device: d.device, start: d.start!, end: d.end })), from, toEnd);
  const facOf = new Map(down.map((d) => [d.device, d.facilityId]));
  const downH = new Map<number, number>();
  for (const [device, ms] of downMs) { const fid = facOf.get(device)!; downH.set(fid, (downH.get(fid) ?? 0) + ms / 3.6e6); }
  const hours = Math.max(0, (toEnd.getTime() - from.getTime()) / 3.6e6);

  const money = prices ? await moneyFigures(ids, f, dev, today) : null;
  const days = periodDays(f);
  return facs.map((x) => {
    const n = devices.find((d) => d.facilityId === x.id)?.n ?? 0;
    const p = ppm.find((d) => d.facilityId === x.id);
    const h: HospitalIn = {
      id: x.id, name: x.name, beds: x.beds, devices: n, ppmDue: p?.due ?? 0, ppmOnTime: p?.onTime ?? 0, openJobs: open.find((d) => d.facilityId === x.id)?.n ?? 0,
      downtimeHours: downH.get(x.id) ?? 0, deviceHours: n * hours,
      ...(money ? { serviceCost: money.service.get(x.id) ?? 0, acquisition: money.acquisition.get(x.id) ?? 0, pricedDevices: money.priced.get(x.id) ?? 0, spend: money.spend.get(x.id) ?? 0 } : {}),
    };
    return { hospital: h, kpis: hospitalKpis(h, days, prices) };
  });
}

/** Service cost and purchase cost of priced devices (for COSR), and invoice spend, per hospital, EGP. */
async function moneyFigures(ids: number[], f: Filters, dev: ReturnType<typeof and>, today: string) {
  const [devs, events, contracts, inv, fx] = await Promise.all([
    db.select({ id: assets.id, facilityId: assets.facilityId, cost: assets.purchaseCost, currency: assets.currency, date: sql<string | null>`coalesce(${assets.purchaseDate}, ${assets.installDate})` })
      .from(assets).where(and(dev, sql`${assets.status} <> 'IN_STOCK'`, isNotNull(assets.purchaseCost))).limit(50_000),
    db.select({ assetId: maintenanceEvents.assetId, date: maintenanceEvents.completedDate, currency: maintenanceEvents.currency, v: sql<string>`sum(${maintenanceEvents.cost})` })
      .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(dev, eq(maintenanceEvents.status, "COMPLETED"), isNotNull(maintenanceEvents.cost), gte(maintenanceEvents.completedDate, f.from), lte(maintenanceEvents.completedDate, f.to)))
      .groupBy(maintenanceEvents.assetId, maintenanceEvents.completedDate, maintenanceEvents.currency).limit(50_000),
    db.select({ id: serviceContracts.id, value: serviceContracts.value, currency: serviceContracts.currency, start: serviceContracts.startDate, end: serviceContracts.endDate,
      devices: sql<number>`(select count(*) from service_contract_assets x where x.contract_id = ${serviceContracts.id})::int` })
      .from(serviceContracts).where(and(inArray(serviceContracts.facilityId, ids), lte(serviceContracts.startDate, f.to), gte(serviceContracts.endDate, f.from), isNotNull(serviceContracts.value))).limit(2000),
    db.select({ facilityId: purchaseOrders.facilityId, date: invoices.invoiceDate, currency: invoices.currency, v: sql<string>`sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice})` })
      .from(invoices).innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id)).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId))
      .where(and(inArray(purchaseOrders.facilityId, ids), inArray(invoices.status, ["APPROVED", "PAID"]), gte(invoices.invoiceDate, f.from), lte(invoices.invoiceDate, f.to)))
      .groupBy(purchaseOrders.facilityId, invoices.invoiceDate, invoices.currency).limit(50_000),
    loadFx(),
  ]);
  const covered = contracts.length ? await db.select({ contractId: serviceContractAssets.contractId, assetId: serviceContractAssets.assetId }).from(serviceContractAssets)
    .where(inArray(serviceContractAssets.contractId, contracts.map((c) => c.id))).limit(50_000) : [];
  const add = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  // Devices without a purchase cost in EGP stay out of the ratio: their price and their service cost (audit B7).
  const acqOf = new Map<number, { fac: number; egp: number }>();
  for (const d of devs) { const v = fx.toEgp(Number(d.cost), d.currency, d.date ?? today); if (v != null && v > 0) acqOf.set(d.id, { fac: d.facilityId, egp: v }); }
  const service = new Map<number, number>(), acquisition = new Map<number, number>(), priced = new Map<number, number>(), spend = new Map<number, number>();
  for (const a of acqOf.values()) { add(acquisition, a.fac, a.egp); add(priced, a.fac, 1); }
  for (const e of events) { const a = acqOf.get(e.assetId); if (!a) continue; add(service, a.fac, fx.toEgp(Number(e.v), e.currency, e.date ?? today) ?? 0); }
  for (const c of contracts) {
    const share = fx.toEgp(contractShare({ value: Number(c.value), start: c.start, end: c.end, devices: c.devices }, f.from, f.to), c.currency, c.start) ?? 0;
    for (const x of covered) if (x.contractId === c.id) { const a = acqOf.get(x.assetId); if (a) add(service, a.fac, share); }
  }
  for (const i of inv) if (i.facilityId != null) add(spend, i.facilityId, fx.toEgp(Number(i.v), i.currency, i.date) ?? 0);
  return { service, acquisition, priced, spend };
}

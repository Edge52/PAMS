import "server-only";
/**
 * Database side of device performance, cost of ownership and the replacement plan. Money is converted to EGP with
 * the stored exchange rates (latest rate per currency; amounts without a rate are left out and counted).
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, departments, deviceTypes, exchangeRates, maintenanceEvents, recallAssets, recalls, serviceContractAssets, serviceContracts, workOrders } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import { daysBetween } from "./dates";
import { costOfOwnership, deviceKpis, replacementScore, type ReplacementScore } from "./lifecycle-kpis";
import { lifecycle } from "./maintenance";
import { annualCostPerAsset } from "./contracts";

/** EGP per unit of each currency (latest stored rate). */
export async function egpRates(): Promise<Map<string, number>> {
  const rows = await db.select({ c: exchangeRates.currency, r: exchangeRates.rateToEgp, d: exchangeRates.effectiveDate }).from(exchangeRates).orderBy(desc(exchangeRates.effectiveDate));
  const m = new Map<string, number>([["EGP", 1]]);
  for (const r of rows) if (!m.has(r.c)) m.set(r.c, num(r.r));
  return m;
}
const toEgp = (rates: Map<string, number>, amount: string | number | null, currency: string | null) => {
  if (amount == null) return 0;
  const r = rates.get(currency ?? "EGP");
  return r == null ? 0 : num(amount) * r;
};

/** Everything the asset page's performance panel shows. */
export async function assetLifecycle(assetId: number) {
  const now = new Date();
  const today = todayISO(now);
  const [[a], jobs, events, contracts, recall, rates] = await Promise.all([
    db.select({ purchaseCost: assets.purchaseCost, currency: assets.currency, installDate: assets.installDate, purchaseDate: assets.purchaseDate,
      life: assets.lifeExpectancyYears, criticality: assets.criticality, condition: assets.condition })
      .from(assets).where(eq(assets.id, assetId)),
    db.select({ type: workOrders.type, status: workOrders.status, reportedAt: workOrders.reportedAt, completedAt: workOrders.completedAt,
      downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd }).from(workOrders).where(eq(workOrders.assetId, assetId)),
    db.select({ cost: maintenanceEvents.cost, currency: maintenanceEvents.currency, date: maintenanceEvents.completedDate }).from(maintenanceEvents)
      .where(and(eq(maintenanceEvents.assetId, assetId), eq(maintenanceEvents.status, "COMPLETED"))),
    db.select({ value: serviceContracts.value, currency: serviceContracts.currency, start: serviceContracts.startDate, end: serviceContracts.endDate,
      n: sql<number>`(select count(*) from service_contract_assets x where x.contract_id = ${serviceContracts.id})::int` })
      .from(serviceContractAssets).innerJoin(serviceContracts, eq(serviceContracts.id, serviceContractAssets.contractId)).where(eq(serviceContractAssets.assetId, assetId)),
    db.select({ n: sql<number>`count(*)::int` }).from(recallAssets).innerJoin(recalls, eq(recalls.id, recallAssets.recallId))
      .where(and(eq(recallAssets.assetId, assetId), eq(recallAssets.status, "PENDING"), eq(recalls.status, "OPEN"))),
    egpRates(),
  ]);
  if (!a) return null;
  const since = a.installDate ?? a.purchaseDate;
  const kpis = deviceKpis(jobs, since ? new Date(`${since}T00:00:00Z`) : null, now);
  const maintenance = events.reduce((s, e) => s + toEgp(rates, e.cost, e.currency), 0);
  const threeYearsAgo = new Date(now.getTime() - 3 * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const maintenance3y = events.filter((e) => (e.date ?? "") >= threeYearsAgo).reduce((s, e) => s + toEgp(rates, e.cost, e.currency), 0);
  // Contract share: the per-device annual cost for the part of each contract that has run so far.
  const contractCost = contracts.reduce((s, c) => {
    const perYear = annualCostPerAsset(c.value != null ? num(c.value) : null, c.start, c.end, c.n);
    if (perYear == null || today < c.start) return s;
    const years = (daysBetween(c.start, today < c.end ? today : c.end) + 1) / 365.25;
    return s + toEgp(rates, perYear * years, c.currency);
  }, 0);
  const purchase = a.purchaseCost != null ? toEgp(rates, a.purchaseCost, a.currency) : null;
  const life = lifecycle(since, a.life, today);
  const score = replacementScore({
    lifeUsedPct: life.pctUsed, repairCostRatio: purchase ? maintenance3y / purchase : null, failures12m: kpis.failures,
    downtimeHours12m: kpis.downtimeHours, criticality: a.criticality, condition: a.condition, openRecall: (recall[0]?.n ?? 0) > 0,
  });
  return { kpis, cost: { purchase, maintenance, contracts: contractCost, ...costOfOwnership(purchase, maintenance, contractCost) }, score, life };
}

export type ReplacementRow = {
  id: number; tag: string; typeId: number; typeName: string; typeCode: string; departmentId: number | null; departmentName: string | null;
  departmentTypeCode: string | null; facilityId: number; status: string; condition: string; criticality: string | null;
  installDate: string | null; lifeYears: number | null; lifeUsedPct: number | null; failures12m: number; downtimeHours12m: number;
  repairCostRatio: number | null; estimateEgp: number | null; score: ReplacementScore;
};

/** Scores for every device in use (in the given hospitals), highest first. */
export async function replacementPlan(where: SQL | undefined): Promise<ReplacementRow[]> {
  const now = new Date();
  const today = todayISO(now);
  const grp = alias(deviceTypes, "rp_grp");
  const rows = await db.select({
    id: assets.id, tag: assets.assetTag, typeId: deviceTypes.id, typeName: deviceTypes.name, typeCode: deviceTypes.code,
    departmentId: assets.departmentId, departmentName: departments.name, departmentTypeCode: departments.departmentTypeCode,
    facilityId: assets.facilityId, status: assets.status, condition: assets.condition, criticality: assets.criticality,
    installDate: sql<string | null>`coalesce(${assets.installDate}, ${assets.purchaseDate})`, lifeYears: sql<number | null>`coalesce(${assets.lifeExpectancyYears}, ${deviceTypes.lifeExpectancyYears})`,
    purchaseCost: assets.purchaseCost, currency: assets.currency, priceMin: deviceTypes.priceMinUsd, priceMax: deviceTypes.priceMaxUsd,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(grp, eq(grp.id, deviceTypes.parentId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(sql`${assets.status} not in ('DISPOSED', 'IN_STOCK')`, where));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  // Per-asset aggregates as grouped queries (one pass each) rather than a subquery per device.
  const yearAgo = sql`now() - interval '365 days'`;
  const [failRows, downRows, recallRows, costs, rates] = await Promise.all([
    db.select({ assetId: workOrders.assetId, n: sql<number>`count(*)::int` }).from(workOrders)
      .where(and(inArray(workOrders.assetId, ids), eq(workOrders.type, "CORRECTIVE"), sql`${workOrders.status} <> 'CANCELLED'`, sql`${workOrders.reportedAt} >= ${yearAgo}`))
      .groupBy(workOrders.assetId),
    db.select({ assetId: workOrders.assetId, h: sql<number>`sum(greatest(0, extract(epoch from (least(coalesce(${workOrders.downtimeEnd}, now()), now())
      - greatest(${workOrders.downtimeStart}, ${yearAgo}))) / 3600))::float` }).from(workOrders)
      .where(and(inArray(workOrders.assetId, ids), sql`${workOrders.downtimeStart} is not null`, sql`${workOrders.status} <> 'CANCELLED'`))
      .groupBy(workOrders.assetId),
    db.selectDistinct({ assetId: recallAssets.assetId }).from(recallAssets).innerJoin(recalls, eq(recalls.id, recallAssets.recallId))
      .where(and(inArray(recallAssets.assetId, ids), eq(recallAssets.status, "PENDING"), eq(recalls.status, "OPEN"))),
    db.select({ assetId: maintenanceEvents.assetId, currency: maintenanceEvents.currency, total: sql<string>`sum(${maintenanceEvents.cost})` }).from(maintenanceEvents)
      .where(and(inArray(maintenanceEvents.assetId, ids), eq(maintenanceEvents.status, "COMPLETED"), sql`${maintenanceEvents.completedDate} >= current_date - interval '3 years'`))
      .groupBy(maintenanceEvents.assetId, maintenanceEvents.currency),
    egpRates(),
  ]);
  const failures = new Map(failRows.map((r) => [r.assetId, Number(r.n)]));
  const downtime = new Map(downRows.map((r) => [r.assetId, Number(r.h)]));
  const recalled = new Set(recallRows.map((r) => r.assetId));
  const spend = new Map<number, number>();
  for (const c of costs) spend.set(c.assetId, (spend.get(c.assetId) ?? 0) + toEgp(rates, c.total, c.currency));
  const usd = rates.get("USD") ?? null;
  return rows.map((r): ReplacementRow => {
    const life = lifecycle(r.installDate, r.lifeYears, today);
    const purchase = r.purchaseCost != null ? toEgp(rates, r.purchaseCost, r.currency) : null;
    const repairCostRatio = purchase ? (spend.get(r.id) ?? 0) / purchase : null;
    const mid = r.priceMin != null || r.priceMax != null ? (num(r.priceMin ?? r.priceMax) + num(r.priceMax ?? r.priceMin)) / 2 : null;
    const estimateEgp = mid != null && usd != null ? Math.round(mid * usd) : purchase;
    return {
      id: r.id, tag: r.tag, typeId: r.typeId, typeName: r.typeName, typeCode: r.typeCode, departmentId: r.departmentId, departmentName: r.departmentName,
      departmentTypeCode: r.departmentTypeCode, facilityId: r.facilityId, status: r.status, condition: r.condition, criticality: r.criticality,
      installDate: r.installDate, lifeYears: r.lifeYears, lifeUsedPct: life.pctUsed, failures12m: failures.get(r.id) ?? 0, downtimeHours12m: downtime.get(r.id) ?? 0,
      repairCostRatio, estimateEgp,
      score: replacementScore({ lifeUsedPct: life.pctUsed, repairCostRatio, failures12m: failures.get(r.id) ?? 0, downtimeHours12m: downtime.get(r.id) ?? 0,
        criticality: r.criticality, condition: r.condition, openRecall: recalled.has(r.id) }),
    };
  }).sort((x, y) => y.score.score - x.score.score || x.tag.localeCompare(y.tag));
}

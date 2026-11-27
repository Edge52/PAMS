import "server-only";
/**
 * Analytics › Procurement (wave 40), database side. Reads are bounded and summed in SQL where they can be; the
 * figures are worked out in ./procurement. Prices are in EGP at the rate on each price's date (an order on its issue
 * date, an offer on its offer date). Offers of a two-envelope tender stay out until its financial envelopes are open.
 */
import { and, eq, gte, inArray, isNotNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  assets, deviceTypes, invoices, offerLines, offers, poLines, projects, purchaseOrders, rfqLines, rfqs, serviceContractAssets, serviceContracts, suppliers, workOrders,
} from "@/db/schema";
import { addDaysISO, num } from "@/lib/format";
import { loadFx } from "@/lib/server-utils";
import { contractStatement } from "@/lib/assets/planning";
import { coveredResponseHours } from "@/lib/assets/coverage-server";
import type { Filters } from "./core";
import { COMMITTED_PO, typeUnder } from "./cost-server";
import { inScope } from "./scope-server";
import {
  daysLate, EARLY_FAULT_DAYS, priceFlags, toPricePoints, type PriceFlag, type PricePoint, type RawPrice, type SupplierFacts, type TenderUnit,
} from "./procurement";

const LIMIT = 5000;
const PRICE_LIMIT = 20_000;
/** Earlier prices go back this many years from the end of the period. */
export const PRICE_YEARS = 5;

/* ── Tender competition ── */

export async function loadTenderUnits(f: Filters, scope: number[], today: string): Promise<TenderUnit[]> {
  const p1 = alias(deviceTypes, "p1"), p2 = alias(deviceTypes, "p2");
  const rows = await db.select({
    id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, issued: rfqs.issueDate, closing: rfqs.closingDate,
    projectId: projects.id, method: projects.procurementMethod,
    bids: sql<number>`(select count(*) from offers o where o.rfq_id = "rfqs"."id" and o.status <> 'WITHDRAWN')::int`,
    awardedOn: sql<string | null>`(select min(coalesce(o.award_approved_on, o.accepted_on))::text from offers o where o.rfq_id = "rfqs"."id" and o.status = 'AWARDED')`,
  }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId))
    .where(and(inArray(rfqs.status, ["ISSUED", "CLOSED"]), inScope(projects.facilityId, scope), gte(rfqs.issueDate, f.from), lte(rfqs.issueDate, f.to),
      f.deviceTypeId ? sql`exists (select 1 from rfq_lines l where l.rfq_id = "rfqs"."id" and ${typeUnder(sql.raw("l.device_type_id"), f.deviceTypeId)})` : undefined))
    .limit(LIMIT);
  const cats = rows.length ? await db.selectDistinct({ rfqId: rfqLines.rfqId, name: sql<string>`coalesce(${p2.name}, ${p1.name}, ${deviceTypes.name})` })
    .from(rfqLines).innerJoin(deviceTypes, eq(deviceTypes.id, rfqLines.deviceTypeId)).leftJoin(p1, eq(p1.id, deviceTypes.parentId)).leftJoin(p2, eq(p2.id, p1.parentId))
    .where(inArray(rfqLines.rfqId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({
    key: `rfq${r.id}`, label: `${r.number} · ${r.title}`, href: `/procurement/${r.projectId}?tab=rfqs`, method: r.method,
    categories: cats.filter((c) => c.rfqId === r.id).map((c) => c.name),
    issued: r.issued, bids: Number(r.bids), awardedOn: r.awardedOn,
    closed: r.status === "CLOSED" || (r.closing != null && r.closing < today) || Number(r.bids) > 0,
  }));
}

/* ── Prices ── */

/** Prices paid (committed order lines, and lines of awarded offers no order was made from) up to `to`. */
async function paidPrices(f: Filters, scope: number[]): Promise<RawPrice[]> {
  const since = addDaysISO(f.to, -365 * PRICE_YEARS);
  const poDate = sql<string>`coalesce(${purchaseOrders.issueDate}, (${purchaseOrders.createdAt})::date)::text`;
  const [po, off] = await Promise.all([
    db.select({ lineId: poLines.id, ref: purchaseOrders.number, poId: purchaseOrders.id, deviceTypeId: poLines.deviceTypeId, typeName: deviceTypes.name,
      manufacturer: poLines.manufacturer, model: poLines.model, date: poDate, currency: purchaseOrders.currency, unitPrice: poLines.unitPrice, offerId: purchaseOrders.offerId })
      .from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).innerJoin(deviceTypes, eq(deviceTypes.id, poLines.deviceTypeId))
      .where(and(inArray(purchaseOrders.status, [...COMMITTED_PO]), inScope(purchaseOrders.facilityId, scope), typeUnder(poLines.deviceTypeId, f.deviceTypeId),
        sql`${poDate} between ${since} and ${f.to}`))
      .limit(PRICE_LIMIT),
    db.select({ lineId: offerLines.id, ref: offers.reference, offerId: offers.id, deviceTypeId: offerLines.deviceTypeId, typeName: deviceTypes.name,
      manufacturer: offerLines.manufacturer, model: offerLines.model, date: sql<string>`${offers.offerDate}::text`, currency: offers.currency,
      unitPrice: offerLines.unitPrice, discountPct: offerLines.discountPct })
      .from(offerLines).innerJoin(offers, eq(offers.id, offerLines.offerId)).innerJoin(projects, eq(projects.id, offers.projectId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, offerLines.deviceTypeId))
      .where(and(eq(offers.status, "AWARDED"), eq(offerLines.isOptional, false), inScope(projects.facilityId, scope), typeUnder(offerLines.deviceTypeId, f.deviceTypeId),
        gte(offers.offerDate, since), lte(offers.offerDate, f.to),
        sql`not exists (select 1 from po_lines x where x.offer_line_id = "offer_lines"."id")`))
      .limit(PRICE_LIMIT),
  ]);
  return [
    ...po.map((r): RawPrice => ({ source: "PO", lineId: r.lineId, offerId: r.offerId, ref: r.ref, href: `/procurement/purchase-orders/${r.poId}`, deviceTypeId: r.deviceTypeId,
      typeName: r.typeName, manufacturer: r.manufacturer, model: r.model, date: r.date, currency: r.currency, unitPrice: num(r.unitPrice) })),
    ...off.map((r): RawPrice => ({ source: "OFFER", lineId: r.lineId, offerId: r.offerId, ref: r.ref, href: `/procurement/offers/${r.offerId}`, deviceTypeId: r.deviceTypeId,
      typeName: r.typeName, manufacturer: r.manufacturer, model: r.model, date: r.date, currency: r.currency, unitPrice: num(r.unitPrice), discountPct: r.discountPct })),
  ];
}

/** Lines of open (not sealed) offers to check against earlier prices. */
async function offerPrices(where: ReturnType<typeof and>): Promise<RawPrice[]> {
  const rows = await db.select({ lineId: offerLines.id, ref: offers.reference, offerId: offers.id, supplier: suppliers.name, deviceTypeId: offerLines.deviceTypeId, typeName: deviceTypes.name,
    manufacturer: offerLines.manufacturer, model: offerLines.model, date: sql<string>`${offers.offerDate}::text`, currency: offers.currency,
    unitPrice: offerLines.unitPrice, discountPct: offerLines.discountPct })
    .from(offerLines).innerJoin(offers, eq(offers.id, offerLines.offerId)).innerJoin(projects, eq(projects.id, offers.projectId))
    .innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(deviceTypes, eq(deviceTypes.id, offerLines.deviceTypeId))
    .where(and(where, eq(offerLines.isOptional, false), notInArray(offers.status, ["WITHDRAWN"]),
      or(eq(projects.twoEnvelope, false), isNotNull(projects.financialOpenedAt))))
    .limit(LIMIT);
  return rows.map((r) => ({ source: "OFFER", lineId: r.lineId, offerId: r.offerId, ref: `${r.supplier} · ${r.ref}`, href: `/procurement/offers/${r.offerId}`,
    deviceTypeId: r.deviceTypeId, typeName: r.typeName, manufacturer: r.manufacturer, model: r.model, date: r.date, currency: r.currency,
    unitPrice: num(r.unitPrice), discountPct: r.discountPct }));
}

export async function loadPrices(f: Filters, scope: number[]): Promise<{ paid: PricePoint[]; flags: PriceFlag[]; checked: number; missing: string[] }> {
  const [paidRaw, offRaw, fx] = await Promise.all([
    paidPrices(f, scope),
    offerPrices(and(inScope(projects.facilityId, scope), typeUnder(offerLines.deviceTypeId, f.deviceTypeId), gte(offers.offerDate, f.from), lte(offers.offerDate, f.to))),
    loadFx(),
  ]);
  const paid = toPricePoints(paidRaw, fx), off = toPricePoints(offRaw, fx);
  return { paid: paid.points, flags: priceFlags(off.points, paid.points), checked: off.points.length, missing: [...new Set([...paid.missing, ...off.missing])].sort() };
}

/**
 * Offers of one tender whose prices are well above earlier prices paid (for a badge on the comparison). Earlier prices
 * come from the hospitals the user may see; the tender itself must not be sealed (the caller shows it only with prices).
 */
export async function offerPriceFlags(projectId: number, scope: number[], today: string): Promise<Map<number, PriceFlag[]>> {
  const [paidRaw, offRaw, fx] = await Promise.all([
    paidPrices({ facilityId: null, departmentId: null, deviceTypeId: null, from: today, to: today }, scope),
    offerPrices(and(eq(offers.projectId, projectId))),
    loadFx(),
  ]);
  const flags = priceFlags(toPricePoints(offRaw, fx).points, toPricePoints(paidRaw, fx).points);
  const out = new Map<number, PriceFlag[]>();
  for (const fl of flags) if (fl.point.offerId != null) (out.get(fl.point.offerId) ?? out.set(fl.point.offerId, []).get(fl.point.offerId)!).push(fl);
  return out;
}

/* ── Supplier scorecard ── */

export async function loadSupplierFacts(f: Filters, scope: number[], today: string): Promise<SupplierFacts[]> {
  const fromTs = `${f.from}T00:00:00Z`, toTs = `${addDaysISO(f.to, 1)}T00:00:00Z`;
  const installed = sql`coalesce(${assets.installDate}, ${assets.purchaseDate})`;
  const [orders, penalties, faults, awards, response, contracts, fx] = await Promise.all([
    db.select({ supplierId: purchaseOrders.supplierId, expected: sql<string>`${purchaseOrders.expectedDelivery}::text`, status: purchaseOrders.status,
      last: sql<string | null>`(select max(d.delivery_date)::text from deliveries d where d.po_id = "purchase_orders"."id")` })
      .from(purchaseOrders)
      .where(and(inArray(purchaseOrders.status, ["ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"]), inScope(purchaseOrders.facilityId, scope),
        gte(purchaseOrders.expectedDelivery, f.from), lte(purchaseOrders.expectedDelivery, f.to)))
      .limit(LIMIT),
    db.select({ supplierId: invoices.supplierId, amount: invoices.delayPenalty, currency: invoices.currency, date: sql<string>`${invoices.invoiceDate}::text` })
      .from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId))
      .where(and(ne(invoices.status, "REJECTED"), sql`${invoices.delayPenalty} > 0`, inScope(purchaseOrders.facilityId, scope), gte(invoices.invoiceDate, f.from), lte(invoices.invoiceDate, f.to)))
      .limit(LIMIT),
    // Devices from the supplier's orders installed in the period, and those with a corrective job within 90 days.
    db.select({ supplierId: purchaseOrders.supplierId, devices: sql<number>`count(*)::int`,
      early: sql<number>`count(*) filter (where exists (select 1 from work_orders w where w.asset_id = "assets"."id" and w.type = 'CORRECTIVE' and w.status <> 'CANCELLED'
        and w.reported_at >= (${installed})::timestamptz and w.reported_at < (${installed})::timestamptz + make_interval(days => ${EARLY_FAULT_DAYS})))::int` })
      .from(assets).innerJoin(poLines, eq(poLines.id, assets.poLineId)).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .where(and(inScope(assets.facilityId, scope), sql`${installed} between ${f.from} and ${f.to}`))
      .groupBy(purchaseOrders.supplierId),
    db.select({ supplierId: offers.supplierId, n: sql<number>`count(*)::int` }).from(offers).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(eq(offers.status, "AWARDED"), inScope(projects.facilityId, scope), sql`coalesce(${offers.awardApprovedOn}, ${offers.acceptedOn}, ${offers.offerDate}) between ${f.from} and ${f.to}`))
      .groupBy(offers.supplierId),
    // Wave 41: the times themselves; the hours are counted in the contract's covered hours below.
    db.select({ supplierId: serviceContracts.supplierId, contractId: serviceContracts.id, facilityId: workOrders.facilityId, reportedAt: workOrders.reportedAt, startedAt: workOrders.startedAt })
      .from(workOrders).innerJoin(serviceContracts, eq(serviceContracts.id, workOrders.contractId))
      .where(and(inScope(workOrders.facilityId, scope), isNotNull(workOrders.startedAt), gte(workOrders.reportedAt, new Date(fromTs)), lte(workOrders.reportedAt, new Date(toTs))))
      .limit(LIMIT),
    db.select({ id: serviceContracts.id, supplierId: serviceContracts.supplierId, start: serviceContracts.startDate, end: serviceContracts.endDate, target: serviceContracts.uptimePct })
      .from(serviceContracts)
      .where(and(inScope(serviceContracts.facilityId, scope), isNotNull(serviceContracts.uptimePct), lte(serviceContracts.startDate, f.to), gte(serviceContracts.endDate, f.from)))
      .limit(500),
    loadFx(),
  ]);

  // Uptime per contract over its part of the period (every hour counts; the monthly statement may use covered hours).
  const covered = contracts.length ? await db.select({ contractId: serviceContractAssets.contractId, assetId: serviceContractAssets.assetId, tag: assets.assetTag })
    .from(serviceContractAssets).innerJoin(assets, eq(assets.id, serviceContractAssets.assetId))
    .where(inArray(serviceContractAssets.contractId, contracts.map((c) => c.id))).limit(LIMIT) : [];
  const assetIds = [...new Set(covered.map((c) => c.assetId))];
  const jobs = assetIds.length ? await db.select({ id: workOrders.id, assetId: workOrders.assetId, number: workOrders.number, title: workOrders.title, reportedAt: workOrders.reportedAt,
    startedAt: workOrders.startedAt, completedAt: workOrders.completedAt, deviceDown: workOrders.deviceDown, downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd })
    .from(workOrders).where(and(inArray(workOrders.assetId, assetIds), eq(workOrders.type, "CORRECTIVE"), ne(workOrders.status, "CANCELLED"),
      lte(workOrders.reportedAt, new Date(toTs)), sql`coalesce(${workOrders.downtimeEnd}, ${workOrders.completedAt}, now()) >= ${fromTs}::timestamptz`))
    .limit(LIMIT) : [];
  const now = new Date();
  const uptime = contracts.map((c) => {
    const mine = covered.filter((x) => x.contractId === c.id);
    const tagOf = new Map(mine.map((x) => [x.assetId, x.tag]));
    const from = new Date(`${c.start > f.from ? c.start : f.from}T00:00:00Z`);
    const endDay = new Date(`${addDaysISO(c.end < f.to ? c.end : f.to, 1)}T00:00:00Z`);
    const to = endDay < now ? endDay : now;
    if (!mine.length || to <= from) return { supplierId: c.supplierId, target: c.target!, actual: null };
    const s = contractStatement(
      { responseHours: null, repairHours: null, uptimePct: c.target, penaltyPerLateHour: null, penaltyPerUptimePoint: null, penaltyCapPct: null, value: null, startDate: c.start, endDate: c.end },
      jobs.filter((j) => tagOf.has(j.assetId)).map((j) => ({ ...j, tag: tagOf.get(j.assetId)! })), mine.length, from, to);
    return { supplierId: c.supplierId, target: c.target!, actual: s.uptimePct };
  });

  const responseH = await coveredResponseHours(response.map((r) => ({ contractId: r.contractId, facilityId: r.facilityId, reportedAt: r.reportedAt, startedAt: r.startedAt! })));
  const ids = new Set<number>([...orders, ...penalties, ...faults, ...awards, ...response, ...uptime].map((r) => r.supplierId));
  const names = ids.size ? await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, [...ids])) : [];
  return names.map((s): SupplierFacts => {
    const pen = penalties.filter((p) => p.supplierId === s.id);
    const fl = faults.find((x) => x.supplierId === s.id);
    return {
      supplierId: s.id, name: s.name,
      deliveries: orders.filter((o) => o.supplierId === s.id).flatMap((o) => { const d = daysLate({ expected: o.expected, status: o.status, lastDelivery: o.last }, today); return d == null ? [] : [d]; }),
      penaltyCount: pen.length, penaltyEgp: pen.reduce((t, p) => t + (fx.toEgp(num(p.amount), p.currency, p.date) ?? 0), 0),
      devicesInstalled: fl ? Number(fl.devices) : 0, devicesEarlyFault: fl ? Number(fl.early) : 0,
      contracts: uptime.filter((u) => u.supplierId === s.id).map((u) => ({ target: u.target, actual: u.actual })),
      responseHours: response.flatMap((r, i) => (r.supplierId === s.id ? [responseH[i]] : [])).filter((h) => Number.isFinite(h) && h >= 0),
      awards: Number(awards.find((a) => a.supplierId === s.id)?.n ?? 0),
    };
  });
}

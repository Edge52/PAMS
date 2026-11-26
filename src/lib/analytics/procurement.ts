/**
 * Analytics › Procurement (wave 40): tender competition, prices against earlier prices paid, and supplier scores.
 * Pure, so the page and the tests agree. Money arrives in EGP (converted at the rate on each price's date).
 *
 * Competition follows the EU Single Market Scoreboard: the share of procedures with a single bid is good at 10 % or
 * less and poor above 20 %. Decision time is from the RFQ's issue date to the award, against 120 days.
 */
import { comparable, median, MIN_N, OUTLIER_Z, robustZ } from "./core";
import type { FxTable } from "../fx";

export const SINGLE_BID_GOOD = 0.1;
export const SINGLE_BID_POOR = 0.2;
export const DECISION_DAYS_BENCHMARK = 120;
export const EARLY_FAULT_DAYS = 90;
export const SCOREBOARD_SOURCE = "EU Single Market Scoreboard";

export function singleBidTone(share: number | null): "ok" | "warn" | "danger" | null {
  if (share == null) return null;
  return share <= SINGLE_BID_GOOD ? "ok" : share <= SINGLE_BID_POOR ? "warn" : "danger";
}

const DAY = 86_400_000;
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/* ── Tender competition ── */

/** One RFQ (or a project's offers without an RFQ). */
export type TenderUnit = {
  key: string;
  label: string;
  href: string;
  /** Law 182 method; null is read as a public tender. */
  method: string | null;
  /** Device categories the RFQ asks for (a unit counts once in each). */
  categories: string[];
  issued: string | null;
  /** Bids received (withdrawn offers left out). */
  bids: number;
  /** Bidding is over: closed, past its closing date, or offers already in. Open ones are left out of the shares. */
  closed: boolean;
  /** First award approval or acceptance. */
  awardedOn: string | null;
};

export type Competition = {
  units: number;
  /** Closed units, the base of the no-offer share. */
  closed: number;
  withBids: number;
  singleBid: number;
  noBids: number;
  /** Single-bid units ÷ closed units with at least one bid. */
  singleBidShare: number | null;
  /** Closed units with no bid ÷ closed units. */
  noOfferShare: number | null;
  meanBids: number | null;
  /** Days from issue to award, for awarded units with an issue date. */
  decisionDays: number[];
  medianDecisionDays: number | null;
  overBenchmark: number;
};

export function competition(units: TenderUnit[]): Competition {
  const closed = units.filter((u) => u.closed);
  const withBids = closed.filter((u) => u.bids > 0);
  const singleBid = withBids.filter((u) => u.bids === 1).length;
  const noBids = closed.length - withBids.length;
  const decisionDays = units.flatMap((u) => {
    if (!u.issued || !u.awardedOn) return [];
    const d = daysBetweenIso(u.issued, u.awardedOn);
    return d >= 0 ? [d] : [];
  });
  return {
    units: units.length, closed: closed.length, withBids: withBids.length, singleBid, noBids,
    singleBidShare: withBids.length ? singleBid / withBids.length : null,
    noOfferShare: closed.length ? noBids / closed.length : null,
    meanBids: withBids.length ? withBids.reduce((s, u) => s + u.bids, 0) / withBids.length : null,
    decisionDays, medianDecisionDays: median(decisionDays), overBenchmark: decisionDays.filter((d) => d > DECISION_DAYS_BENCHMARK).length,
  };
}

/** Competition per group (method or category). A unit with several categories counts in each. */
export function competitionBy(units: TenderUnit[], keys: (u: TenderUnit) => string[]): ({ key: string } & Competition)[] {
  const groups = new Map<string, TenderUnit[]>();
  for (const u of units) for (const k of new Set(keys(u))) (groups.get(k) ?? groups.set(k, []).get(k)!).push(u);
  return [...groups.entries()].map(([key, list]) => ({ key, ...competition(list) })).sort((a, b) => b.units - a.units || a.key.localeCompare(b.key));
}

/* ── Prices ── */

/** A price as it comes from the database, in its own currency. */
export type RawPrice = {
  source: "PO" | "OFFER";
  /** PO line or offer line id. */
  lineId: number;
  /** The offer (for offer lines), so an offer is never compared with itself. */
  offerId: number | null;
  ref: string;
  href: string;
  deviceTypeId: number;
  typeName: string;
  manufacturer: string | null;
  model: string | null;
  date: string;
  currency: string;
  unitPrice: number;
  discountPct?: number | null;
};

export type PricePoint = Omit<RawPrice, "unitPrice" | "discountPct"> & { egp: number; modelKey: string | null };

/** "Philips Ingenia 1.5T" → "philips|ingenia 1.5t"; null without a model. */
export function modelKey(manufacturer: string | null | undefined, model: string | null | undefined): string | null {
  const m = (model ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!m) return null;
  return `${(manufacturer ?? "").trim().toLowerCase().replace(/\s+/g, " ")}|${m}`;
}

/** Net unit price (after discount) in EGP at the rate of its date. Prices with no rate are left out and listed. */
export function toPricePoints(raw: RawPrice[], fx: Pick<FxTable, "toEgp">): { points: PricePoint[]; missing: string[] } {
  const points: PricePoint[] = [];
  const missing = new Set<string>();
  for (const r of raw) {
    const net = r.unitPrice * (1 - Math.min(100, Math.max(0, r.discountPct ?? 0)) / 100);
    if (!Number.isFinite(net) || net <= 0) continue;
    const egp = fx.toEgp(net, r.currency, r.date);
    if (egp == null) { missing.add((r.currency || "EGP").toUpperCase()); continue; }
    points.push({
      source: r.source, lineId: r.lineId, offerId: r.offerId, ref: r.ref, href: r.href, deviceTypeId: r.deviceTypeId, typeName: r.typeName,
      manufacturer: r.manufacturer, model: r.model, date: r.date, currency: r.currency, egp, modelKey: modelKey(r.manufacturer, r.model),
    });
  }
  return { points, missing: [...missing].sort() };
}

export type Benchmark = {
  key: string;
  deviceTypeId: number;
  typeName: string;
  /** Null for the device type as a whole. */
  model: string | null;
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  /** n ≥ MIN_N: the figures can be shown. */
  shown: boolean;
};

function bench(key: string, list: PricePoint[], model: string | null): Benchmark {
  const xs = list.map((p) => p.egp);
  const ok = comparable(xs.length);
  return {
    key, deviceTypeId: list[0].deviceTypeId, typeName: list[0].typeName, model, n: xs.length, shown: ok,
    median: ok ? median(xs) : null, min: ok ? Math.min(...xs) : null, max: ok ? Math.max(...xs) : null,
  };
}

/** Prices paid per device type, and per model within it when the model has its own prices. Figures hidden under MIN_N. */
export function priceBenchmarks(points: PricePoint[]): Benchmark[] {
  const byType = new Map<number, PricePoint[]>();
  for (const p of points) (byType.get(p.deviceTypeId) ?? byType.set(p.deviceTypeId, []).get(p.deviceTypeId)!).push(p);
  const out: Benchmark[] = [];
  for (const [typeId, list] of [...byType.entries()].sort((a, b) => a[1][0].typeName.localeCompare(b[1][0].typeName))) {
    out.push(bench(`t${typeId}`, list, null));
    const byModel = new Map<string, PricePoint[]>();
    for (const p of list) if (p.modelKey) (byModel.get(p.modelKey) ?? byModel.set(p.modelKey, []).get(p.modelKey)!).push(p);
    if (byModel.size < 2 && [...byModel.values()][0]?.length === list.length) continue; // one model only: same as the type
    for (const [k, ms] of [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const label = [ms[0].manufacturer, ms[0].model].filter(Boolean).join(" ");
      out.push(bench(`t${typeId}:${k}`, ms, label));
    }
  }
  return out;
}

export type PriceFlag = {
  point: PricePoint;
  /** What it was compared with: the same model when it has MIN_N earlier prices, else the device type. */
  basis: "model" | "type";
  n: number;
  median: number;
  z: number;
};

/**
 * Offer prices well above earlier prices paid: robust z-score (median and MAD) over the prices dated before the
 * offer, other offers' own lines left out, above OUTLIER_Z. Needs MIN_N earlier prices (same model first, else type).
 */
export function priceFlags(offers: PricePoint[], history: PricePoint[], zLimit = OUTLIER_Z): PriceFlag[] {
  const flags: PriceFlag[] = [];
  for (const o of offers) {
    const earlier = history.filter((h) => h.deviceTypeId === o.deviceTypeId && h.date < o.date && !(h.offerId != null && h.offerId === o.offerId));
    const sameModel = o.modelKey ? earlier.filter((h) => h.modelKey === o.modelKey) : [];
    const [basis, base] = comparable(sameModel.length) ? ["model", sameModel] as const : ["type", earlier] as const;
    const xs = base.map((h) => h.egp);
    const z = robustZ(o.egp, xs);
    if (z != null && z > zLimit) flags.push({ point: o, basis, n: xs.length, median: median(xs)!, z });
  }
  return flags.sort((a, b) => b.z - a.z);
}

/* ── Supplier scorecard ── */

export type SupplierFacts = {
  supplierId: number;
  name: string;
  /** Orders due in the period: days late (negative = early). Still-open late orders count up to today. */
  deliveries: number[];
  penaltyCount: number;
  penaltyEgp: number;
  /** Devices from its orders installed in the period, and those with a fault within EARLY_FAULT_DAYS. */
  devicesInstalled: number;
  devicesEarlyFault: number;
  /** Service contracts with an uptime target: target and actual, %. */
  contracts: { target: number; actual: number | null }[];
  /** Hours from report to start of work on jobs under its contracts. */
  responseHours: number[];
  awards: number;
};

export type SupplierScore = {
  supplierId: number;
  name: string;
  /** Deliveries counted (the n of the on-time share). */
  n: number;
  onTimeShare: number | null;
  avgDelayDays: number | null;
  penaltyCount: number;
  penaltyEgp: number;
  devicesInstalled: number;
  earlyFaultShare: number | null;
  uptimeMet: number;
  uptimeOf: number;
  medianResponseH: number | null;
  responseN: number;
  awards: number;
  /** Rank by on-time share (then delay); null when n < MIN_N. */
  rank: number | null;
};

export function supplierScores(facts: SupplierFacts[]): SupplierScore[] {
  const rows: SupplierScore[] = facts.map((f) => {
    const n = f.deliveries.length;
    const known = f.contracts.filter((c) => c.actual != null);
    return {
      supplierId: f.supplierId, name: f.name, n,
      onTimeShare: n ? f.deliveries.filter((d) => d <= 0).length / n : null,
      avgDelayDays: n ? f.deliveries.reduce((s, d) => s + Math.max(0, d), 0) / n : null,
      penaltyCount: f.penaltyCount, penaltyEgp: Math.round(f.penaltyEgp * 100) / 100,
      devicesInstalled: f.devicesInstalled,
      earlyFaultShare: f.devicesInstalled ? Math.min(f.devicesEarlyFault, f.devicesInstalled) / f.devicesInstalled : null,
      uptimeMet: known.filter((c) => c.actual! >= c.target).length, uptimeOf: known.length,
      medianResponseH: median(f.responseHours), responseN: f.responseHours.length,
      awards: f.awards, rank: null,
    };
  });
  const ranked = rows.filter((r) => comparable(r.n)).sort((a, b) => b.onTimeShare! - a.onTimeShare! || a.avgDelayDays! - b.avgDelayDays! || a.name.localeCompare(b.name));
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.awards - a.awards || b.n - a.n || a.name.localeCompare(b.name));
}

/** Days late of an order from what was received (money-server's scorecard rule): null when not due yet. */
export function daysLate(o: { expected: string; status: string; lastDelivery: string | null }, today: string): number | null {
  if (o.status === "DELIVERED" || o.status === "CLOSED") return o.lastDelivery ? daysBetweenIso(o.expected, o.lastDelivery) : null;
  return o.expected < today ? daysBetweenIso(o.expected, today) : null;
}

export { MIN_N };

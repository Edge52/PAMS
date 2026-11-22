/**
 * Service cost and the cost of service ratio (COSR), wave 27. Pure — the report and the tests share it.
 *
 * COSR = service cost in a period ÷ acquisition cost of the same devices. Service cost is the cost of completed
 * maintenance and repairs (work orders write their cost to the maintenance record, parts included) plus each service
 * contract's share for the period, split evenly over the devices it covers. Money arrives in EGP.
 *
 * Devices without a purchase cost can't have a ratio: their service cost is shown but kept out of the ratio.
 */
import { addDays, daysBetween } from "../assets/dates";

/** A yearly COSR under about 5–6 % is usually read as good value. A guide, not a rule: it varies by device type. */
export const COSR_GUIDE_PCT = 6;
export const COSR_HIGH_PCT = 10;
export const COSR_NOTE = `As a guide, a yearly COSR under about 5–6 % is usually good value and over ${COSR_HIGH_PCT} % is worth a look. ` +
  "It is not a rule: imaging and other complex devices often run higher, simple devices lower.";

export type CostSource = "IN_HOUSE" | "CONTRACT";

/** Part of a contract's value that falls in [from, to] (inclusive days), per covered device. */
export function contractShare(c: { value: number | null; start: string; end: string; devices: number }, from: string, to: string): number {
  if (c.value == null || !(c.value > 0) || c.end < c.start) return 0;
  const a = c.start > from ? c.start : from;
  const b = c.end < to ? c.end : to;
  if (b < a) return 0;
  const overlap = daysBetween(a, b) + 1;
  const whole = daysBetween(c.start, c.end) + 1;
  return (c.value * overlap / whole) / Math.max(1, c.devices);
}

/** Days in the period, inclusive. */
export function periodDays(from: string, to: string): number {
  return Math.max(1, daysBetween(from, addDays(to, 1)));
}

/** Percentage, one decimal; null without an acquisition cost. */
export function cosrPct(service: number, acquisition: number): number | null {
  if (!(acquisition > 0)) return null;
  return Math.round((service / acquisition) * 1000) / 10;
}

/** The period's COSR scaled to a year, so it can be read against the guide. */
export function yearlyCosr(pct: number | null, days: number): number | null {
  if (pct == null || !(days > 0)) return null;
  return Math.round(pct * (365.25 / days) * 10) / 10;
}

export function cosrTone(v: unknown): "ok" | "warn" | "danger" | null {
  if (typeof v !== "number") return null;
  return v <= COSR_GUIDE_PCT ? "ok" : v <= COSR_HIGH_PCT ? "warn" : "danger";
}

export type CostDevice = { id: number; acquisition: number | null };
export type CostLine = {
  assetId: number; amount: number; source: CostSource;
  /** Wave 29: who did the work: the vendor on the job, the contract's company, or the hospital's own team. */
  provider?: { key: string; label: string; supplierId: number | null };
};

export type ProviderRollup = { key: string; label: string; supplierId: number | null; devices: number; jobs: number; cost: number; acquisition: number; cosr: number | null; cosrYear: number | null };

/**
 * Service cost by the company that did the work (wave 29). Each provider's ratio is its cost against the purchase
 * cost of the devices it served (each device counted once per provider). Devices without a purchase cost in EGP stay
 * in the cost but out of the ratio. Lines without a provider are grouped as "Not recorded".
 */
export function byProvider(lines: CostLine[], acquisitionOf: (assetId: number) => number | null, days: number): ProviderRollup[] {
  const groups = new Map<string, { key: string; label: string; supplierId: number | null; assets: Set<number>; jobs: number; cost: number; costs: { assetId: number; amount: number }[] }>();
  for (const l of lines) {
    if (!Number.isFinite(l.amount) || l.amount === 0) continue;
    const p = l.provider ?? { key: "unknown", label: "Not recorded", supplierId: null };
    const g = groups.get(p.key) ?? { ...p, assets: new Set<number>(), jobs: 0, cost: 0, costs: [] };
    g.assets.add(l.assetId); g.jobs += 1; g.cost += l.amount; g.costs.push({ assetId: l.assetId, amount: l.amount });
    groups.set(p.key, g);
  }
  return [...groups.values()].map((g) => {
    // B7: a device without a purchase cost in EGP (none recorded, or no exchange rate) is left out of the ratio,
    // its cost as well as its price, as in rollUp; counting its price as 0 would inflate the ratio.
    const priced = [...g.assets].filter((id) => (acquisitionOf(id) ?? 0) > 0);
    const acquisition = priced.reduce((a, id) => a + acquisitionOf(id)!, 0);
    const pricedCost = g.costs.filter((c) => priced.includes(c.assetId)).reduce((a, c) => a + c.amount, 0);
    const cosr = cosrPct(pricedCost, acquisition);
    return { key: g.key, label: g.label, supplierId: g.supplierId, devices: g.assets.size, jobs: g.jobs, cost: Math.round(g.cost * 100) / 100, acquisition, cosr, cosrYear: yearlyCosr(cosr, days) };
  }).sort((a, b) => b.cost - a.cost);
}

export type CostRollup = {
  devices: number;
  /** Devices with a known purchase cost (the ones in the ratio). */
  priced: number;
  acquisition: number;
  inHouse: number;
  contract: number;
  total: number;
  /** Service cost of devices without a purchase cost (in total, not in the ratio). */
  unpricedService: number;
  cosr: number | null;
  cosrYear: number | null;
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Group devices by a key and add up their service costs. `keyOf` returns the group key and label for a device.
 * Rows come back sorted by total service cost, highest first.
 */
export function rollUp<D extends CostDevice>(devices: D[], lines: CostLine[], keyOf: (d: D) => { key: string; label: string }, days: number): ({ key: string; label: string } & CostRollup)[] {
  const byAsset = new Map<number, { inHouse: number; contract: number }>();
  for (const l of lines) {
    if (!Number.isFinite(l.amount) || l.amount === 0) continue;
    const x = byAsset.get(l.assetId) ?? { inHouse: 0, contract: 0 };
    if (l.source === "IN_HOUSE") x.inHouse += l.amount; else x.contract += l.amount;
    byAsset.set(l.assetId, x);
  }
  const groups = new Map<string, { key: string; label: string } & CostRollup & { pricedService: number }>();
  for (const d of devices) {
    const k = keyOf(d);
    const g = groups.get(k.key) ?? { ...k, devices: 0, priced: 0, acquisition: 0, inHouse: 0, contract: 0, total: 0, unpricedService: 0, cosr: null, cosrYear: null, pricedService: 0 };
    const c = byAsset.get(d.id) ?? { inHouse: 0, contract: 0 };
    g.devices++;
    g.inHouse += c.inHouse;
    g.contract += c.contract;
    g.total += c.inHouse + c.contract;
    if (d.acquisition != null && d.acquisition > 0) { g.priced++; g.acquisition += d.acquisition; g.pricedService += c.inHouse + c.contract; }
    else g.unpricedService += c.inHouse + c.contract;
    groups.set(k.key, g);
  }
  return [...groups.values()].map(({ pricedService, ...g }) => {
    const cosr = cosrPct(pricedService, g.acquisition);
    return { ...g, acquisition: r2(g.acquisition), inHouse: r2(g.inHouse), contract: r2(g.contract), total: r2(g.total), unpricedService: r2(g.unpricedService), cosr, cosrYear: yearlyCosr(cosr, days) };
  }).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Totals over every device (same rules as one group). */
export function grandTotal(devices: CostDevice[], lines: CostLine[], days: number): CostRollup {
  const [all] = rollUp(devices, lines, () => ({ key: "all", label: "All" }), days);
  return all ?? { devices: 0, priced: 0, acquisition: 0, inHouse: 0, contract: 0, total: 0, unpricedService: 0, cosr: null, cosrYear: null };
}

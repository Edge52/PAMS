/**
 * BOQ pricing — pure helpers (totals per department, per category, contingency, grand total).
 * Unit price defaults come from the device type's USD price band; conversion to the BOQ currency happens on the
 * server (see ./queries.ts → defaultUnitPrices) because it needs exchange rates.
 */
import { num, round2 } from "../format";

/** Midpoint of a USD price band. One-sided bands use the side that exists; no band → null. */
export function midpointUsd(min: string | number | null | undefined, max: string | number | null | undefined): number | null {
  const hasMin = min !== null && min !== undefined && min !== "";
  const hasMax = max !== null && max !== undefined && max !== "";
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax) return round2((num(min) + num(max)) / 2);
  return round2(num(hasMin ? min : max));
}

export interface PricedLine {
  boqDepartmentId: number | null;
  categoryKey: string;          // level-1 device category code (or "—")
  quantity: number;
  unitPriceEstimate: string | number | null;
}

export interface Totals {
  byDepartment: Map<number | null, number>;
  byCategory: Map<string, number>;
  subtotal: number;
  contingency: number;
  grandTotal: number;
  /** Lines with quantity > 0 but no unit price — the total understates the budget by these. */
  unpricedLines: number;
}

export function lineAmount(quantity: number, unitPrice: string | number | null): number {
  return round2(quantity * num(unitPrice));
}

export function computeTotals(lines: PricedLine[], contingencyPct: number): Totals {
  const byDepartment = new Map<number | null, number>();
  const byCategory = new Map<string, number>();
  let subtotal = 0;
  let unpricedLines = 0;
  for (const l of lines) {
    const amt = lineAmount(l.quantity, l.unitPriceEstimate);
    if (l.quantity > 0 && (l.unitPriceEstimate === null || l.unitPriceEstimate === "" || num(l.unitPriceEstimate) === 0)) unpricedLines++;
    byDepartment.set(l.boqDepartmentId, round2((byDepartment.get(l.boqDepartmentId) ?? 0) + amt));
    byCategory.set(l.categoryKey, round2((byCategory.get(l.categoryKey) ?? 0) + amt));
    subtotal = round2(subtotal + amt);
  }
  const contingency = round2(subtotal * (contingencyPct || 0) / 100);
  return { byDepartment, byCategory, subtotal, contingency, grandTotal: round2(subtotal + contingency), unpricedLines };
}

/* ── Price tiers (wave 3) ── */

export const PRICE_TIERS = ["BASIC", "STANDARD", "PREMIUM"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
export const PRICE_TIER_LABELS: Record<PriceTier, string> = { BASIC: "Basic", STANDARD: "Standard", PREMIUM: "Premium" };
export const PRICE_TIER_HELP: Record<PriceTier, string> = {
  BASIC: "Bottom of the catalogue price band: entry-level models.",
  STANDARD: "Middle of the band: mainstream models.",
  PREMIUM: "Top of the band: high-end models and options.",
};

/** USD unit price for a tier from the catalogue band: basic = low end, standard = midpoint, premium = high end. */
export function tierPriceUsd(min: string | number | null | undefined, max: string | number | null | undefined, tier: PriceTier): number | null {
  const mid = midpointUsd(min, max);
  if (mid === null) return null;
  const has = (v: unknown) => v !== null && v !== undefined && v !== "";
  if (tier === "BASIC") return has(min) ? round2(num(min)) : mid;
  if (tier === "PREMIUM") return has(max) ? round2(num(max)) : mid;
  return mid;
}

/** The tier that prices a line: its own, else its department's, else the BOQ's. */
export function effectiveTier(line: PriceTier | null | undefined, dept: PriceTier | null | undefined, boq: PriceTier): PriceTier {
  return line ?? dept ?? boq;
}

export type ScenarioLine = { quantity: number; min: string | number | null; max: string | number | null; currentPrice: string | number | null; priceManual: boolean };

/**
 * The BOQ priced at each tier (in USD, from the bands; the caller converts). Lines with a hand-typed price keep it in
 * every scenario (`rate` converts it to USD); lines with no band and no price are counted as unpriced.
 */
export function scenarioTotals(lines: ScenarioLine[], toUsd: (amount: number) => number, contingencyPct: number) {
  const out = {} as Record<PriceTier, { subtotal: number; total: number }>;
  let unpriced = 0;
  for (const t of PRICE_TIERS) {
    let sub = 0;
    for (const l of lines) {
      if (l.quantity <= 0) continue;
      if (l.priceManual && l.currentPrice != null) { sub += l.quantity * toUsd(num(l.currentPrice)); continue; }
      const p = tierPriceUsd(l.min, l.max, t);
      if (p === null) { if (t === "STANDARD") unpriced++; continue; }
      sub += l.quantity * p;
    }
    out[t] = { subtotal: round2(sub), total: round2(sub * (1 + (contingencyPct || 0) / 100)) };
  }
  return { byTier: out, unpriced };
}

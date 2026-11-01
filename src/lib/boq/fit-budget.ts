/**
 * Fit a BOQ to its target budget (pure). Order of cuts, cheapest pain first:
 *   1. drop optional lines, biggest first;
 *   2. move recommended lines one price tier down (premium → standard → basic), biggest saving first.
 * Essential lines and prices typed by hand are never touched. Stops as soon as the total is within the target.
 */
import { PRICE_TIERS, PRICE_TIER_LABELS, type PriceTier } from "./pricing";

export type FitLine = {
  id: number; name: string; department: string;
  tier: "ESSENTIAL" | "RECOMMENDED" | "OPTIONAL";
  quantity: number;
  /** Current unit price (BOQ currency). */
  unitPrice: number;
  /** The tier the line is priced at now. */
  priceTier: PriceTier;
  priceManual: boolean;
  /** Unit price at each tier (BOQ currency); null when the catalogue has no band. */
  tierPrices: Record<PriceTier, number | null>;
};

export type FitChange =
  | { kind: "drop"; lineId: number; name: string; department: string; quantity: number; saving: number }
  | { kind: "tier"; lineId: number; name: string; department: string; from: PriceTier; to: PriceTier; unitPrice: number; saving: number };

export type FitResult = { before: number; after: number; target: number; reached: boolean; changes: FitChange[]; untouchable: number };

export function fitToBudget(lines: FitLine[], target: number, contingencyPct: number): FitResult {
  const k = 1 + (contingencyPct || 0) / 100;
  const amount = (l: FitLine) => l.quantity * l.unitPrice;
  const before = Math.round(lines.reduce((t, l) => t + amount(l), 0) * k * 100) / 100;
  let total = before;
  const changes: FitChange[] = [];
  const over = () => total > target + 0.005;

  // 1. Optional lines, biggest first.
  for (const l of lines.filter((x) => x.tier === "OPTIONAL" && x.quantity > 0).sort((a, b) => amount(b) - amount(a))) {
    if (!over()) break;
    const saving = amount(l) * k;
    changes.push({ kind: "drop", lineId: l.id, name: l.name, department: l.department, quantity: l.quantity, saving: round(saving) });
    total -= saving;
  }
  // 2. Recommended lines one tier down at a time, biggest saving first; repeat while a step down still saves.
  const state = new Map(lines.map((l) => [l.id, { tier: l.priceTier, price: l.unitPrice }]));
  for (let pass = 0; pass < PRICE_TIERS.length - 1 && over(); pass++) {
    const steps = lines.filter((l) => l.tier === "RECOMMENDED" && !l.priceManual && l.quantity > 0).flatMap((l) => {
      const s = state.get(l.id)!;
      const i = PRICE_TIERS.indexOf(s.tier);
      if (i <= 0) return [];
      const to = PRICE_TIERS[i - 1];
      const p = l.tierPrices[to];
      if (p == null || p >= s.price) return [];
      return [{ l, from: s.tier, to, price: p, saving: (s.price - p) * l.quantity * k }];
    }).sort((a, b) => b.saving - a.saving);
    for (const st of steps) {
      if (!over()) break;
      const prev = changes.findIndex((c) => c.kind === "tier" && c.lineId === st.l.id);
      if (prev >= 0) {
        const c = changes[prev] as Extract<FitChange, { kind: "tier" }>;
        changes[prev] = { ...c, to: st.to, unitPrice: st.price, saving: round(c.saving + st.saving) };
      } else {
        changes.push({ kind: "tier", lineId: st.l.id, name: st.l.name, department: st.l.department, from: st.from, to: st.to, unitPrice: st.price, saving: round(st.saving) });
      }
      state.set(st.l.id, { tier: st.to, price: st.price });
      total -= st.saving;
    }
  }
  const untouchable = round(lines.filter((l) => l.tier === "ESSENTIAL" || l.priceManual).reduce((t, l) => t + amount(l), 0) * k);
  return { before, after: round(total), target, reached: !over(), changes, untouchable };
}

export function describeChange(c: FitChange): string {
  return c.kind === "drop"
    ? `Drop ${c.quantity} × ${c.name} (${c.department}), optional`
    : `${c.name} (${c.department}): ${PRICE_TIER_LABELS[c.from].toLowerCase()} → ${PRICE_TIER_LABELS[c.to].toLowerCase()} price`;
}

const round = (n: number) => Math.round(n * 100) / 100;

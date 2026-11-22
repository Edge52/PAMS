/**
 * Late-delivery penalties on purchase orders (wave 37, audit "missing features" 5). Pure — no database.
 *
 * Law 182/2018 delay fines: a rate for each week of delay, or part of a week, on the value of the late items only,
 * up to a maximum share of that value. The rate and the cap are set per purchase order, with defaults in settings
 * (1 % a week, at most 15 %).
 *
 *   - Units delivered on or before the expected delivery date carry no penalty.
 *   - Each later delivery is counted on its own: its units × unit price × min(rate × weeks late, cap).
 *     Weeks late = days late ÷ 7, rounded up (one day late is one week).
 *   - Units not delivered yet count up to `asOf` (normally today) while the order is open: the figure grows until
 *     they arrive and is marked provisional. On a closed or cancelled order they are left out.
 */
import { round2 } from "../format";

export type PenaltyTerms = { ratePctPerWeek: number; capPct: number };
export type PenaltyLine = { id: number; description: string; quantity: number; unitPrice: number };
export type PenaltyDelivery = { date: string; lines: { poLineId: number; quantity: number }[] };

export type PenaltyPart = {
  poLineId: number; description: string; units: number; unitPrice: number;
  /** units × unit price */
  value: number;
  /** Delivery date, or null for units still outstanding on `asOf`. */
  deliveredOn: string | null;
  daysLate: number; weeks: number;
  /** Penalty share applied, in % (rate × weeks, capped). */
  pct: number; capped: boolean;
  amount: number;
};

export type PenaltyResult = {
  due: string | null;
  asOf: string;
  terms: PenaltyTerms;
  parts: PenaltyPart[];
  /** Value of the late units. */
  lateValue: number;
  amount: number;
  /** Some units are still outstanding and late: the amount will grow until they arrive. */
  provisional: boolean;
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);

/** Days and started weeks between the due date and the delivery date (0 when on time or early). */
export function weeksLate(due: string, delivered: string): { days: number; weeks: number } {
  const days = Math.max(0, daysBetween(due, delivered));
  return { days, weeks: Math.ceil(days / 7) };
}

/** Rate and cap for an order: its own, else the hospital defaults. Values outside 0–100 fall back to the default. */
export function penaltyTerms(po: { delayPenaltyRatePct?: number | null; delayPenaltyCapPct?: number | null }, defaults: PenaltyTerms): PenaltyTerms {
  const ok = (v: number | null | undefined) => v != null && Number.isFinite(v) && v >= 0 && v <= 100;
  return { ratePctPerWeek: ok(po.delayPenaltyRatePct) ? po.delayPenaltyRatePct! : defaults.ratePctPerWeek, capPct: ok(po.delayPenaltyCapPct) ? po.delayPenaltyCapPct! : defaults.capPct };
}

export function delayPenalty(input: {
  expectedDelivery: string | null; lines: PenaltyLine[]; deliveries: PenaltyDelivery[]; terms: PenaltyTerms; asOf: string;
  /** Count units still outstanding up to asOf (open orders). Default true. */
  countOutstanding?: boolean;
}): PenaltyResult {
  const { expectedDelivery: due, terms, asOf } = input;
  const empty: PenaltyResult = { due, asOf, terms, parts: [], lateValue: 0, amount: 0, provisional: false };
  if (!due) return empty;
  const parts: PenaltyPart[] = [];
  const part = (l: PenaltyLine, units: number, deliveredOn: string | null, until: string) => {
    const { days, weeks } = weeksLate(due, until);
    if (units <= 0 || weeks <= 0) return;
    const raw = terms.ratePctPerWeek * weeks;
    const pct = Math.min(raw, terms.capPct);
    const value = round2(units * l.unitPrice);
    parts.push({ poLineId: l.id, description: l.description, units, unitPrice: l.unitPrice, value, deliveredOn, daysLate: days, weeks, pct, capped: raw > terms.capPct, amount: round2((value * pct) / 100) });
  };
  const sorted = [...input.deliveries].sort((a, b) => a.date.localeCompare(b.date));
  for (const l of input.lines) {
    let left = l.quantity; // deliveries beyond the ordered quantity don't count
    for (const d of sorted) {
      const q = Math.min(left, d.lines.filter((x) => x.poLineId === l.id).reduce((s, x) => s + x.quantity, 0));
      if (q <= 0) continue;
      left -= q;
      part(l, q, d.date, d.date);
    }
    if (left > 0 && input.countOutstanding !== false) part(l, left, null, asOf);
  }
  return {
    due, asOf, terms, parts,
    lateValue: round2(parts.reduce((s, p) => s + p.value, 0)),
    amount: round2(parts.reduce((s, p) => s + p.amount, 0)),
    provisional: parts.some((p) => p.deliveredOn == null),
  };
}

/** One line per late part, for the invoice deduction note and the PO page. `money` formats an amount. */
export function penaltyLines(r: PenaltyResult, money: (n: number) => string): string[] {
  return r.parts.map((p) => `${p.units} × ${p.description}: ${p.deliveredOn ? `delivered ${p.deliveredOn}` : `not delivered by ${r.asOf}`}, ${p.daysLate} day${p.daysLate === 1 ? "" : "s"} late = ${p.weeks} week${p.weeks === 1 ? "" : "s"} × ${r.terms.ratePctPerWeek} % = ${p.pct} %${p.capped ? ` (cap ${r.terms.capPct} %)` : ""} of ${money(p.value)} = ${money(p.amount)}`);
}

/** The deduction note stored on an invoice: the terms, each part and the total. */
export function penaltyNote(r: PenaltyResult, money: (n: number) => string): string {
  return [`Delay penalty: ${r.terms.ratePctPerWeek} % a week or part of a week, at most ${r.terms.capPct} % of the late items, due ${r.due}.`, ...penaltyLines(r, money), `Total ${money(r.amount)}.`].join("\n");
}

/** What may still be deducted: the penalty less what other invoices of the order already deducted. */
export function penaltyLeft(amount: number, deductedElsewhere: number): number {
  return round2(Math.max(0, amount - Math.max(0, deductedElsewhere)));
}

/** Why a deduction can't be saved on an invoice, or null. */
export function deductionProblem(deduction: number, invoiceTotal: number, left: number): string | null {
  if (!Number.isFinite(deduction) || deduction < 0) return "Enter the penalty to deduct as an amount, or 0 to remove it.";
  if (deduction > invoiceTotal + 0.005) return "The penalty can't be more than the invoice total.";
  if (deduction > left + 0.005) return `The penalty left to deduct on this order is ${left.toFixed(2)}.`;
  return null;
}

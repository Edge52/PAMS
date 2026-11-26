/**
 * Late-delivery penalties on purchase orders (wave 37; Law 182/2018 rules in wave 39). Pure — no database.
 *
 * Law 182/2018 art. 48 and Executive Regulation (Decree 692/2019) art. 98, from unofficial copies — the figures are
 * admin settings, to be checked against the official Gazette:
 *
 *   - Supply and services: a step by how long the delay is, as a share of the whole delivery period (order issue to
 *     expected delivery): up to 3 % of the period → 1 % of the value; up to 6 % → 2 %; up to 10 % → 3 %; more → 5 %.
 *     At most 5 %.
 *   - Works: a rate for each week of delay or part of a week (1 %), at most 10 %, or 15 % when the delay is more than
 *     10 % of the period.
 *   - Basis: the value of the late items only, or the whole order when the late part prevents use of what was
 *     delivered (ticked on the order).
 *   - A waiver (with its reason) sets the amount to deduct to zero; the calculation stays visible.
 *
 * How parts are counted:
 *   - Units delivered on or before the expected delivery date carry no penalty.
 *   - Each later delivery is counted on its own: units × unit price × the share for its delay.
 *     Weeks late = days late ÷ 7, rounded up (one day late is one week).
 *   - Units not delivered yet count up to `asOf` (normally today) while the order is open: the figure grows until
 *     they arrive and is marked provisional. On a closed or cancelled order they are left out.
 */
import { round2 } from "../format";

export const CONTRACT_TYPES = ["SUPPLY", "SERVICES", "WORKS"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = { SUPPLY: "Supply", SERVICES: "Services", WORKS: "Works" };
export function isContractType(v: unknown): v is ContractType {
  return typeof v === "string" && (CONTRACT_TYPES as readonly string[]).includes(v);
}
/** Not set = supply: purchase orders are for equipment and goods. */
export function contractTypeOf(v: string | null | undefined): ContractType {
  return isContractType(v) ? v : "SUPPLY";
}

/** A supply/services step: a delay up to `upToPct` % of the delivery period costs `pct` % of the basis. */
export type SupplyStep = { upToPct: number; pct: number };

export type PenaltyRules = {
  /** In ascending order of upToPct. */
  supplySteps: SupplyStep[];
  /** Delay above the last step. */
  supplyOverPct: number;
  supplyCapPct: number;
  worksRatePctPerWeek: number;
  worksCapPct: number;
  /** Works: when the delay is more than `worksLongFromPct` % of the period, the cap is `worksLongCapPct`. */
  worksLongFromPct: number;
  worksLongCapPct: number;
};

/** Law 182 art. 48 and Reg. art. 98, as read from unofficial copies. */
export const LAW_PENALTY_RULES: PenaltyRules = {
  supplySteps: [{ upToPct: 3, pct: 1 }, { upToPct: 6, pct: 2 }, { upToPct: 10, pct: 3 }],
  supplyOverPct: 5, supplyCapPct: 5,
  worksRatePctPerWeek: 1, worksCapPct: 10, worksLongFromPct: 10, worksLongCapPct: 15,
};

/** Settings keys that hold the rules (flat, so the settings form can compare them one by one). */
export type PenaltySettings = {
  delaySupplyStep1UpToPct: number; delaySupplyStep1Pct: number;
  delaySupplyStep2UpToPct: number; delaySupplyStep2Pct: number;
  delaySupplyStep3UpToPct: number; delaySupplyStep3Pct: number;
  delaySupplyOverPct: number; delaySupplyCapPct: number;
  /** Works: % a week (the wave 37 key, kept). */
  delayPenaltyRatePct: number;
  /** Works: the normal cap (the wave 37 key, kept). */
  delayPenaltyCapPct: number;
  delayWorksLongFromPct: number; delayWorksLongCapPct: number;
};

export const DEFAULT_PENALTY_SETTINGS: PenaltySettings = {
  delaySupplyStep1UpToPct: 3, delaySupplyStep1Pct: 1,
  delaySupplyStep2UpToPct: 6, delaySupplyStep2Pct: 2,
  delaySupplyStep3UpToPct: 10, delaySupplyStep3Pct: 3,
  delaySupplyOverPct: 5, delaySupplyCapPct: 5,
  delayPenaltyRatePct: 1, delayPenaltyCapPct: 10,
  delayWorksLongFromPct: 10, delayWorksLongCapPct: 15,
};

export function rulesFromSettings(s: PenaltySettings): PenaltyRules {
  return {
    supplySteps: [
      { upToPct: s.delaySupplyStep1UpToPct, pct: s.delaySupplyStep1Pct },
      { upToPct: s.delaySupplyStep2UpToPct, pct: s.delaySupplyStep2Pct },
      { upToPct: s.delaySupplyStep3UpToPct, pct: s.delaySupplyStep3Pct },
    ].sort((a, b) => a.upToPct - b.upToPct),
    supplyOverPct: s.delaySupplyOverPct, supplyCapPct: s.delaySupplyCapPct,
    worksRatePctPerWeek: s.delayPenaltyRatePct, worksCapPct: s.delayPenaltyCapPct,
    worksLongFromPct: s.delayWorksLongFromPct, worksLongCapPct: s.delayWorksLongCapPct,
  };
}

/** Why a set of penalty settings doesn't hold together, or null. */
export function penaltySettingsProblem(s: PenaltySettings): string | null {
  const ups = [s.delaySupplyStep1UpToPct, s.delaySupplyStep2UpToPct, s.delaySupplyStep3UpToPct];
  const pcts = [s.delaySupplyStep1Pct, s.delaySupplyStep2Pct, s.delaySupplyStep3Pct, s.delaySupplyOverPct];
  if (!(ups[0] < ups[1] && ups[1] < ups[2])) return "The supply steps' delay limits must go up: step 1 below step 2 below step 3.";
  if (pcts.some((p, i) => i > 0 && p < pcts[i - 1])) return "Each supply step's penalty must be at least the one before it.";
  if (s.delaySupplyCapPct < s.delaySupplyOverPct) return "The supply cap is below the last step's penalty. Check the figures.";
  if (s.delayPenaltyCapPct < s.delayPenaltyRatePct) return "The works cap is normally at or above the weekly rate. Check the two figures.";
  if (s.delayWorksLongCapPct < s.delayPenaltyCapPct) return "The works cap for long delays is normally at or above the normal cap.";
  return null;
}

export type PenaltyTerms = {
  contractType: ContractType;
  rules: PenaltyRules;
  /** The late part prevents use of what was delivered: the basis is the whole order. */
  blocksUse: boolean;
  /** Whole delivery period in days (order issue to expected delivery); null when it can't be worked out. */
  periodDays: number | null;
};
export type PenaltyLine = { id: number; description: string; quantity: number; unitPrice: number };
export type PenaltyDelivery = { date: string; lines: { poLineId: number; quantity: number }[] };

export type PenaltyPart = {
  /** 0 for the whole-order part. */
  poLineId: number; description: string; units: number; unitPrice: number;
  /** The basis: units × unit price, or the whole order's value. */
  value: number;
  /** Delivery date, or null for units still outstanding on `asOf`. */
  deliveredOn: string | null;
  daysLate: number; weeks: number;
  /** Delay as a share of the delivery period, in % (null when the period is unknown). */
  sharePct: number | null;
  /** Penalty share applied, in % (step or rate × weeks, capped). */
  pct: number; capPct: number; capped: boolean;
  amount: number;
};

export type PenaltyResult = {
  due: string | null;
  asOf: string;
  terms: PenaltyTerms;
  parts: PenaltyPart[];
  basis: "LATE_ITEMS" | "WHOLE_ORDER";
  /** Value of the basis (late units, or the whole order). */
  lateValue: number;
  /** The penalty before any waiver. */
  grossAmount: number;
  /** What may be deducted: 0 when waived. */
  amount: number;
  waived: string | null;
  /** Some units are still outstanding and late: the amount will grow until they arrive. */
  provisional: boolean;
};

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);
const EPS = 1e-9;

/** Days and started weeks between the due date and the delivery date (0 when on time or early). */
export function weeksLate(due: string, delivered: string): { days: number; weeks: number } {
  const days = Math.max(0, daysBetween(due, delivered));
  return { days, weeks: Math.ceil(days / 7) };
}

/** Whole delivery period in days, from the order's issue date to the expected delivery (at least 1). */
export function deliveryPeriodDays(issued: string | null | undefined, due: string | null | undefined): number | null {
  if (!issued || !due) return null;
  return Math.max(1, daysBetween(issued, due));
}

/** Supply and services: the step for a delay that is `sharePct` % of the period (unknown period = the last step). */
export function supplyStepPct(rules: PenaltyRules, sharePct: number | null): number {
  if (sharePct == null) return rules.supplyOverPct;
  if (sharePct <= 0) return 0;
  const step = rules.supplySteps.find((s) => sharePct <= s.upToPct + EPS);
  return step ? step.pct : rules.supplyOverPct;
}

/** Works: the cap that applies for a delay that is `sharePct` % of the period. */
export function worksCapPct(rules: PenaltyRules, sharePct: number | null): number {
  return sharePct != null && sharePct > rules.worksLongFromPct + EPS ? rules.worksLongCapPct : rules.worksCapPct;
}

/** The share of the basis for one delay. */
export function penaltyPct(terms: PenaltyTerms, daysLate: number): { pct: number; capPct: number; capped: boolean; sharePct: number | null; weeks: number } {
  const weeks = Math.ceil(Math.max(0, daysLate) / 7);
  const sharePct = terms.periodDays ? (Math.max(0, daysLate) / terms.periodDays) * 100 : null;
  if (daysLate <= 0) return { pct: 0, capPct: 0, capped: false, sharePct: 0, weeks: 0 };
  const r = terms.rules;
  const [raw, cap] = terms.contractType === "WORKS"
    ? [r.worksRatePctPerWeek * weeks, worksCapPct(r, sharePct)]
    : [supplyStepPct(r, sharePct), r.supplyCapPct];
  return { pct: round2(Math.min(raw, cap)), capPct: cap, capped: raw > cap + EPS, sharePct: sharePct == null ? null : round2(sharePct), weeks };
}

/** Per-order overrides (blank = the hospital rules). A rate replaces the works weekly rate; a cap replaces every cap. */
export type PoPenaltyFields = {
  delayPenaltyRatePct?: number | null; delayPenaltyCapPct?: number | null;
  contractType?: string | null; blocksUse?: boolean | null;
};

/** The terms for an order: its own overrides on top of the hospital rules. Values outside 0–100 are ignored. */
export function penaltyTerms(po: PoPenaltyFields, rules: PenaltyRules, periodDays: number | null = null): PenaltyTerms {
  const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v >= 0 && v <= 100;
  const r: PenaltyRules = { ...rules, supplySteps: [...rules.supplySteps] };
  if (ok(po.delayPenaltyRatePct)) r.worksRatePctPerWeek = po.delayPenaltyRatePct;
  if (ok(po.delayPenaltyCapPct)) { r.supplyCapPct = po.delayPenaltyCapPct; r.worksCapPct = po.delayPenaltyCapPct; r.worksLongCapPct = po.delayPenaltyCapPct; }
  return { contractType: contractTypeOf(po.contractType), rules: r, blocksUse: !!po.blocksUse, periodDays };
}

export function delayPenalty(input: {
  expectedDelivery: string | null; lines: PenaltyLine[]; deliveries: PenaltyDelivery[]; terms: PenaltyTerms; asOf: string;
  /** Count units still outstanding up to asOf (open orders). Default true. */
  countOutstanding?: boolean;
  /** Reason the penalty was waived, if it was. */
  waivedReason?: string | null;
}): PenaltyResult {
  const { expectedDelivery: due, terms, asOf } = input;
  const waived = input.waivedReason?.trim() || null;
  const basis = terms.blocksUse ? "WHOLE_ORDER" as const : "LATE_ITEMS" as const;
  const empty: PenaltyResult = { due, asOf, terms, parts: [], basis, lateValue: 0, grossAmount: 0, amount: 0, waived, provisional: false };
  if (!due) return empty;
  const make = (poLineId: number, description: string, units: number, unitPrice: number, value: number, deliveredOn: string | null, until: string): PenaltyPart | null => {
    const { days } = weeksLate(due, until);
    if (units <= 0 || days <= 0) return null;
    const p = penaltyPct(terms, days);
    return { poLineId, description, units, unitPrice, value, deliveredOn, daysLate: days, weeks: p.weeks, sharePct: p.sharePct, pct: p.pct, capPct: p.capPct, capped: p.capped, amount: round2((value * p.pct) / 100) };
  };
  let parts: PenaltyPart[] = [];
  const sorted = [...input.deliveries].sort((a, b) => a.date.localeCompare(b.date));
  for (const l of input.lines) {
    let left = l.quantity; // deliveries beyond the ordered quantity don't count
    for (const d of sorted) {
      const q = Math.min(left, d.lines.filter((x) => x.poLineId === l.id).reduce((s, x) => s + x.quantity, 0));
      if (q <= 0) continue;
      left -= q;
      const p = make(l.id, l.description, q, l.unitPrice, round2(q * l.unitPrice), d.date, d.date);
      if (p) parts.push(p);
    }
    if (left > 0 && input.countOutstanding !== false) {
      const p = make(l.id, l.description, left, l.unitPrice, round2(left * l.unitPrice), null, asOf);
      if (p) parts.push(p);
    }
  }
  // The late part prevents use of the rest: one part on the whole order, at the longest delay.
  if (terms.blocksUse && parts.length) {
    const worst = parts.reduce((a, b) => (b.daysLate > a.daysLate ? b : a));
    const whole = round2(input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const units = input.lines.reduce((s, l) => s + l.quantity, 0);
    parts = [make(0, "Whole order (the late part prevents use of what was delivered)", units, 0, whole, worst.deliveredOn, worst.deliveredOn ?? asOf)!];
  }
  const gross = round2(parts.reduce((s, p) => s + p.amount, 0));
  return {
    due, asOf, terms, parts, basis,
    lateValue: round2(parts.reduce((s, p) => s + p.value, 0)),
    grossAmount: gross,
    amount: waived ? 0 : gross,
    waived,
    provisional: parts.some((p) => p.deliveredOn == null),
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The rule in one sentence, for the order page and the invoice note. */
export function termsText(t: PenaltyTerms): string {
  const r = t.rules;
  const basis = t.blocksUse ? "the whole order (the late part prevents use of what was delivered)" : "the late items";
  if (t.contractType === "WORKS") {
    return `Works: ${r.worksRatePctPerWeek} % of ${basis} for each week of delay or part of a week, at most ${r.worksCapPct} % (${r.worksLongCapPct} % when the delay is more than ${r.worksLongFromPct} % of the delivery period).`;
  }
  const steps = r.supplySteps.map((s) => `up to ${s.upToPct} % → ${s.pct} %`).join(", ");
  return `${CONTRACT_TYPE_LABELS[t.contractType]}: a share of ${basis} by the delay as a part of the delivery period (${steps}, more → ${r.supplyOverPct} %), at most ${r.supplyCapPct} %.`;
}

/** One line per late part, for the invoice deduction note and the PO page. `money` formats an amount. */
export function penaltyLines(r: PenaltyResult, money: (n: number) => string): string[] {
  const t = r.terms;
  return r.parts.map((p) => {
    const when = p.deliveredOn ? `delivered ${p.deliveredOn}` : `not delivered by ${r.asOf}`;
    const late = `${plural(p.daysLate, "day")} late`;
    const share = p.sharePct == null ? "delivery period unknown" : `${p.sharePct} % of the ${t.periodDays}-day period`;
    const how = t.contractType === "WORKS"
      ? `${plural(p.weeks, "week")} × ${t.rules.worksRatePctPerWeek} % = ${p.pct} %${p.capped ? ` (cap ${p.capPct} %)` : ""}`
      : `${share} → ${p.pct} %${p.capped ? ` (cap ${p.capPct} %)` : ""}`;
    const what = p.poLineId === 0 ? p.description : `${p.units} × ${p.description}`;
    return t.contractType === "WORKS"
      ? `${what}: ${when}, ${late} (${share}) = ${how} of ${money(p.value)} = ${money(p.amount)}`
      : `${what}: ${when}, ${late} = ${how} of ${money(p.value)} = ${money(p.amount)}`;
  });
}

/** The deduction note stored on an invoice: the terms, each part and the total. */
export function penaltyNote(r: PenaltyResult, money: (n: number) => string): string {
  return [
    `Delay penalty (Law 182/2018 art. 48): ${termsText(r.terms)} Due ${r.due}.`,
    ...penaltyLines(r, money),
    r.waived ? `Total ${money(r.grossAmount)}, waived: ${r.waived}` : `Total ${money(r.amount)}.`,
  ].join("\n");
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

/** Why a waiver can't be saved, or null. */
export function waiverProblem(reason: string | null | undefined): string | null {
  const r = reason?.trim() ?? "";
  if (r.length < 10) return "Give the reason for the waiver (for example the competent authority's decision and why the delay was not the supplier's fault).";
  return null;
}

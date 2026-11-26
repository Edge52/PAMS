/**
 * Money and contracts (wave 10): invoice three-way match, budget use, framework call-off limits, bonds and supplier
 * scorecards. Pure; amounts in one currency (the caller converts).
 */

import { lineTotal } from "../format";
import { addMonths } from "../assets/dates";

/* ── Offer → purchase order prices ── */

/**
 * DL-10: the PO lines for `qty` units of an offer line, priced so they add up to the offer's own line total
 * (quantity × price × (1 − discount), rounded to the cent once). A PO stores whole-cent unit prices, so when that
 * total doesn't split evenly some units carry one cent more, on a second line.
 */
export function orderLinePrices(qty: number, unitPrice: number, discountPct: number): { quantity: number; unitPrice: string }[] {
  const d = Number.isFinite(discountPct) ? Math.min(Math.max(discountPct, 0), 100) : 0;
  const cents = Math.round(lineTotal(qty, unitPrice, d) * 100);
  const base = Math.floor(cents / qty), extra = cents - base * qty;
  const out = [{ quantity: qty - extra, unitPrice: (base / 100).toFixed(2) }];
  if (extra) out.push({ quantity: extra, unitPrice: ((base + 1) / 100).toFixed(2) });
  return out;
}

/* ── Three-way match: what was ordered, what was received, what is invoiced ── */

export type MatchLine = {
  poLineId: number; description: string;
  ordered: number; received: number; poUnitPrice: number;
  /** Already invoiced on other (not rejected) invoices. */
  invoicedBefore: number;
  quantity: number; unitPrice: number;
};
export type LineMatch = MatchLine & { problems: string[]; difference: number };
export type MatchResult = { lines: LineMatch[]; ok: boolean; total: number; poTotal: number; difference: number };

/** Price tolerance: an invoice price within this share of the PO price still matches (rounding, bank charges). */
export const PRICE_TOLERANCE = 0.01;

export function matchInvoice(lines: MatchLine[], tolerance = PRICE_TOLERANCE): MatchResult {
  const out = lines.map((l): LineMatch => {
    const problems: string[] = [];
    const after = l.invoicedBefore + l.quantity;
    if (after > l.ordered) problems.push(`invoices ${after} of ${l.ordered} ordered`);
    else if (after > l.received) problems.push(`invoices ${after} but only ${l.received} received`);
    if (l.unitPrice > l.poUnitPrice * (1 + tolerance) + 0.005) problems.push(`price ${fmt(l.unitPrice)} above the PO's ${fmt(l.poUnitPrice)}`);
    return { ...l, problems, difference: round2(l.quantity * (l.unitPrice - l.poUnitPrice)) };
  });
  const total = round2(out.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const poTotal = round2(out.reduce((s, l) => s + l.quantity * l.poUnitPrice, 0));
  return { lines: out, ok: out.every((l) => !l.problems.length) && out.some((l) => l.quantity > 0), total, poTotal, difference: round2(total - poTotal) };
}

/* ── Budgets ── */

export type BudgetLevel = "OK" | "WARN" | "OVER";
/** Committed (POs approved or issued, not yet invoiced) plus spent (invoices approved or paid) against the amount. */
export function budgetUse(amount: number, committed: number, spent: number) {
  const used = committed + spent;
  const pct = amount > 0 ? used / amount : used > 0 ? Infinity : 0;
  const level: BudgetLevel = pct >= 1 ? "OVER" : pct >= 0.8 ? "WARN" : "OK";
  return { used, remaining: amount - used, pct, level };
}
/** POs that commit money: approved onwards, not cancelled. */
export const COMMITTING = ["APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"] as const;

/**
 * What one PO adds to its budget line. `value` is what it orders, `received` the value of the goods received and
 * `invoiced` its approved or paid invoices. Invoices count as spent whatever the PO's status (DL-09). A PO closed short
 * commits only what was received and not yet invoiced; a cancelled one commits nothing more (B3).
 */
export function poBudgetShare(status: string, value: number, received: number, invoiced: number) {
  const requested = status === "PENDING_APPROVAL" || status === "DRAFT" ? value : 0;
  const committed = status === "CLOSED" ? Math.max(0, received - invoiced)
    : (COMMITTING as readonly string[]).includes(status) ? Math.max(0, value - invoiced) : 0;
  return { committed, spent: invoiced, requested };
}

/** The warning to raise when a PO of `value` is added: crossing 80 % or 100 %, or null. */
export function budgetCrossing(amount: number, usedBefore: number, value: number): "80" | "100" | null {
  if (amount <= 0) return null;
  const a = usedBefore / amount, b = (usedBefore + value) / amount;
  return a < 1 && b >= 1 ? "100" : a < 0.8 && b >= 0.8 ? "80" : null;
}

/* ── Framework agreements ── */

export type FrameworkCheck = { ok: boolean; problems: string[] };
/** A call-off must fall within the agreement's dates, its ceiling and each item's quantity limit. */
export function checkCallOff(fw: { startDate: string; endDate: string; ceiling: number; calledOff: number }, items: { description: string; qty: number; unitPrice: number; maxQty: number | null; usedQty: number }[], today: string): FrameworkCheck {
  const problems: string[] = [];
  if (today < fw.startDate) problems.push(`The agreement starts on ${fw.startDate}.`);
  if (today > fw.endDate) problems.push(`The agreement ended on ${fw.endDate}.`);
  const value = round2(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
  if (!items.some((i) => i.qty > 0)) problems.push("Enter a quantity for at least one item.");
  if (fw.calledOff + value > fw.ceiling + 0.005) problems.push(`This call-off (${fmt(value)}) would take the agreement to ${fmt(fw.calledOff + value)}, over its ceiling of ${fmt(fw.ceiling)}.`);
  for (const i of items) if (i.maxQty != null && i.usedQty + i.qty > i.maxQty) problems.push(`${i.description}: ${i.usedQty + i.qty} would exceed the ${i.maxQty} agreed.`);
  return { ok: !problems.length, problems };
}

/* ── Bonds (Law 182/2018: bid bond 1.5 % art. 16, performance bond 5 % art. 40) ── */

export const BOND_RATE = { BID: 0.015, PERFORMANCE: 0.05, ADVANCE_PAYMENT: 1 } as const;
export const requiredBond = (kind: keyof typeof BOND_RATE, value: number) => round2(value * BOND_RATE[kind]);

/**
 * Bid bond (Law 182/2018 art. 16, Reg. art. 30; wave 39): up to 1.5 % of the tender's ESTIMATED value — not of each
 * offer. `estimate` and `stated` (the amount in the tender conditions, if set) are in the same currency.
 * `required` is the stated amount, else the 1.5 % maximum; null when there's no estimate and nothing stated.
 */
export function bidBond(estimate: number | null, stated: number | null = null): { max: number | null; required: number | null; problem: string | null } {
  const max = estimate != null && estimate > 0 ? requiredBond("BID", estimate) : null;
  const s = stated != null && Number.isFinite(stated) && stated >= 0 ? round2(stated) : null;
  const problem = s != null && max != null && s > max + 0.005
    ? `The bid bond can be at most ${BOND_RATE.BID * 100} % of the estimated value (${max.toFixed(2)}).`
    : s == null && max == null ? "No estimated value: set the project budget (or link a priced BOQ) to work out the bid bond." : null;
  return { max, required: s ?? max, problem };
}

/* ── Supplier scorecard ── */

export type ScoreInput = {
  /** POs with an expected date and a first full delivery: days late (negative = early). */
  deliveries: { daysLate: number }[];
  /** Devices accepted, and those with an acceptance issue or rejected. */
  accepted: number; acceptanceIssues: number;
  /** Warranty jobs on its devices: hours to the start of work. */
  warrantyResponseHours: number[];
  /** Invoices, and those with differences. */
  invoices: number; invoiceExceptions: number;
};
export type Scorecard = { onTimePct: number | null; avgDaysLate: number | null; acceptancePct: number | null; warrantyMedianH: number | null; invoiceMatchPct: number | null; score: number | null; grade: "A" | "B" | "C" | "D" | null };

/** Four measures, each 0–100 where known; the score is their average (delivery counts double). */
export function scorecard(i: ScoreInput): Scorecard {
  const onTimePct = i.deliveries.length ? i.deliveries.filter((d) => d.daysLate <= 0).length / i.deliveries.length * 100 : null;
  const avgDaysLate = i.deliveries.length ? i.deliveries.reduce((s, d) => s + Math.max(0, d.daysLate), 0) / i.deliveries.length : null;
  const acceptancePct = i.accepted + i.acceptanceIssues ? i.accepted / (i.accepted + i.acceptanceIssues) * 100 : null;
  const sorted = [...i.warrantyResponseHours].sort((a, b) => a - b);
  const warrantyMedianH = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const warrantyScore = warrantyMedianH == null ? null : Math.max(0, Math.min(100, 100 - (warrantyMedianH - 24) * (100 / 144))); // 24 h → 100, a week → 0
  const invoiceMatchPct = i.invoices ? (i.invoices - i.invoiceExceptions) / i.invoices * 100 : null;
  const parts: [number | null, number][] = [[onTimePct, 2], [acceptancePct, 1], [warrantyScore, 1], [invoiceMatchPct, 1]];
  const known = parts.filter(([v]) => v != null) as [number, number][];
  const score = known.length ? Math.round(known.reduce((s, [v, w]) => s + v * w, 0) / known.reduce((s, [, w]) => s + w, 0)) : null;
  const grade = score == null ? null : score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  return { onTimePct, avgDaysLate, acceptancePct, warrantyMedianH, invoiceMatchPct, score, grade };
}

/* ── Acceptance ── */

/** Default delivery, installation and acceptance checks when a device type has none of its own. */
export const DEFAULT_ACCEPTANCE: { text: string }[] = [
  { text: "Delivered complete against the packing list and PO (model, accessories, manuals)" },
  { text: "No transport damage" },
  { text: "Serial number matches the delivery note" },
  { text: "Installed and commissioned by the supplier" },
  { text: "Electrical safety test passed" },
  { text: "Performance / acceptance tests passed" },
  { text: "User training given and attendance signed" },
  { text: "Operator and service manuals handed over" },
];

/** Acceptance is complete with both signatures and no failed check; the warranty then runs from the acceptance date. */
export function warrantyEndFrom(acceptedOn: string, months: number | null | undefined): string | null {
  if (!months) return null;
  return addMonths(acceptedOn, months); // clamped to the month's end: 31 Aug + 6 months = 28 Feb, not 3 Mar (DL-11)
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 2 });

/* ── Who may do what on an invoice ── */

/**
 * Segregation of duties on supplier invoices (wave 34, audit S7 / DL-19).
 *
 * Same rule as the approval engine (lib/approvals/core canDecide): whoever submits may not decide, and nobody
 * decides two steps of the same thing. For an invoice the steps are record → approve (or reject) → record payment,
 * so three different people:
 *  - the person who recorded it may not approve or reject it;
 *  - the person who approved it may not record its payment, and nor may the person who recorded it.
 * Administrators are not exempt: there is no small-site setting that allows one person to do it all.
 *
 * People are compared by account id. Invoices recorded before wave 34 have only names, so then the name is compared.
 */
export type Person = { id: number; name: string };
export type InvoicePeople = {
  createdById: number | null; createdByName: string | null;
  approvedById: number | null; approvedByName: string | null;
};

function same(me: Person, id: number | null, name: string | null): boolean {
  if (id != null) return id === me.id;
  return name != null && name.trim() !== "" && name.trim() === me.name.trim();
}

/** Why `me` may not take this step on the invoice, or null when allowed. Shown to the user. */
export function invoiceDutyProblem(step: "decide" | "pay", inv: InvoicePeople, me: Person): string | null {
  const recorded = same(me, inv.createdById, inv.createdByName);
  if (step === "decide") return recorded ? "You recorded this invoice, so someone else must approve or reject it." : null;
  if (recorded) return "You recorded this invoice, so someone else must record its payment.";
  if (same(me, inv.approvedById, inv.approvedByName)) return "You approved this invoice, so someone else must record its payment.";
  return null;
}

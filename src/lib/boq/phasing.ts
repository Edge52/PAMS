/**
 * Phasing and cash flow (pure). Departments open in phases; each phase opens a number of months after phase 1.
 * Equipment is paid in two parts: a share when ordered (lead time before opening, longer for big imaging) and the
 * rest on delivery, a month before the phase opens. Spending is grouped by calendar quarter.
 */

export const MAX_PHASES = 4;
export const DEFAULT_PHASE_MONTHS = [0, 6, 12, 18];
/** Share paid with the order; the rest on delivery. */
export const ADVANCE_SHARE = 0.3;

/** Months between order and opening, by code prefix (longest match wins). */
export const LEAD_MONTHS: { prefix: string; months: number }[] = [
  { prefix: "IMG-MRI", months: 10 }, { prefix: "IMG-CT", months: 6 }, { prefix: "IMG-ANG", months: 8 }, { prefix: "IMG-", months: 6 },
  { prefix: "THR-RT", months: 12 }, { prefix: "LAB-", months: 5 }, { prefix: "STE-", months: 6 }, { prefix: "FUR-", months: 3 }, { prefix: "", months: 4 },
];
export const leadMonths = (code: string) => LEAD_MONTHS.filter((l) => code.startsWith(l.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0].months;

export function cleanPhaseMonths(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : [];
  const out = DEFAULT_PHASE_MONTHS.map((d, i) => {
    const n = Number(arr[i]);
    return i === 0 ? 0 : Number.isFinite(n) && n >= 0 && n <= 120 ? Math.round(n) : d;
  });
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
  return out;
}

/** "2027-01-01" + n months → { y, q } calendar quarter. */
function quarterOf(start: string, monthOffset: number): string {
  const [y, m] = start.split("-").map(Number);
  const total = y * 12 + (m - 1) + monthOffset;
  const yy = Math.floor(total / 12), q = Math.floor((total % 12) / 3) + 1;
  return `${yy} Q${q}`;
}

export type PhaseLine = { phase: number; code: string; amount: number };
export type CashRow = { quarter: string; advance: number; delivery: number; total: number; cumulative: number };

export function cashFlow(lines: PhaseLine[], opening: string, phaseMonths: number[]) {
  const months = cleanPhaseMonths(phaseMonths);
  const map = new Map<string, { advance: number; delivery: number; order: number }>();
  const add = (offset: number, k: "advance" | "delivery", v: number) => {
    const q = quarterOf(opening, offset);
    const r = map.get(q) ?? { advance: 0, delivery: 0, order: offset };
    r[k] += v; r.order = Math.min(r.order, offset); map.set(q, r);
  };
  const byPhase = new Map<number, number>();
  for (const l of lines) {
    if (!(l.amount > 0)) continue;
    const p = Math.min(MAX_PHASES, Math.max(1, l.phase || 1));
    const open = months[p - 1];
    add(open - leadMonths(l.code), "advance", l.amount * ADVANCE_SHARE);
    add(open - 1, "delivery", l.amount * (1 - ADVANCE_SHARE));
    byPhase.set(p, (byPhase.get(p) ?? 0) + l.amount);
  }
  let cum = 0;
  const rows: CashRow[] = [...map.entries()].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])).map(([quarter, r]) => {
    cum += r.advance + r.delivery;
    return { quarter, advance: r.advance, delivery: r.delivery, total: r.advance + r.delivery, cumulative: cum };
  });
  return {
    rows,
    phases: [...byPhase.entries()].sort((a, b) => a[0] - b[0]).map(([phase, amount]) => ({ phase, amount, opensMonth: months[phase - 1], opens: quarterOf(opening, months[phase - 1]) })),
    firstOrder: rows[0]?.quarter ?? null,
  };
}

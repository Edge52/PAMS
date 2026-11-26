/**
 * Analytics › Cost (wave 40): spend on purchase orders and invoices, in EGP, by supplier, device category,
 * department, year and currency. Pure, so the page and the tests agree.
 *
 * The page sums the lines in SQL by date, currency and the grouping keys; this file converts each sum to EGP at the
 * rate in force on its date (an order on its issue date, an invoice on its invoice date) and groups the result.
 * Amounts in a currency with no stored rate are left out of the EGP totals and listed.
 */
import type { FxTable } from "../fx";

export type SpendBasis = "po" | "invoice";
export type SpendDim = "supplier" | "category" | "department" | "year" | "currency";

export const SPEND_DIMS: { id: SpendDim; label: string }[] = [
  { id: "supplier", label: "Supplier" },
  { id: "category", label: "Device category" },
  { id: "department", label: "Department" },
  { id: "year", label: "Year" },
  { id: "currency", label: "Currency" },
];

/** One summed group of lines from the database, in its own currency. */
export type SpendRow = {
  date: string;
  currency: string;
  amount: number;
  /** Number of lines in the sum. */
  lines: number;
  supplierId: number | null; supplier: string | null;
  categoryId: number | null; category: string | null;
  departmentId: number | null; department: string | null;
};

export type SpendLine = SpendRow & { egp: number };

export type SpendGroup = {
  key: string;
  label: string;
  /** Link id: supplier, category or department id; null for year, currency and "not recorded". */
  id: number | null;
  egp: number;
  /** Share of the total, 0–1. */
  share: number;
  lines: number;
  /** Currency groups only: the sum in the currency itself. */
  original?: number;
};

/** Convert each row at the rate of its date. Rows in a currency with no rate are left out and the currency listed. */
export function convertSpend(rows: SpendRow[], fx: Pick<FxTable, "toEgp">): { lines: SpendLine[]; missing: string[] } {
  const lines: SpendLine[] = [];
  const missing = new Set<string>();
  for (const r of rows) {
    if (!Number.isFinite(r.amount)) continue;
    const egp = fx.toEgp(r.amount, r.currency, r.date);
    if (egp == null) { if (r.amount !== 0) missing.add((r.currency || "EGP").toUpperCase()); continue; }
    lines.push({ ...r, egp });
  }
  return { lines, missing: [...missing].sort() };
}

const NONE: Record<SpendDim, string> = {
  supplier: "No supplier recorded", category: "No category", department: "No department given", year: "", currency: "",
};

function keyOf(l: SpendLine, dim: SpendDim): { key: string; label: string; id: number | null } {
  switch (dim) {
    case "supplier": return l.supplierId == null ? { key: "none", label: NONE.supplier, id: null } : { key: `s${l.supplierId}`, label: l.supplier ?? `Supplier ${l.supplierId}`, id: l.supplierId };
    case "category": return l.categoryId == null ? { key: "none", label: NONE.category, id: null } : { key: `c${l.categoryId}`, label: l.category ?? `Category ${l.categoryId}`, id: l.categoryId };
    case "department": return l.departmentId == null ? { key: "none", label: NONE.department, id: null } : { key: `d${l.departmentId}`, label: l.department ?? `Department ${l.departmentId}`, id: l.departmentId };
    case "year": return { key: l.date.slice(0, 4), label: l.date.slice(0, 4), id: null };
    case "currency": { const c = (l.currency || "EGP").toUpperCase(); return { key: c, label: c, id: null }; }
  }
}

/** EGP total of the lines, to the piastre. */
export function spendTotal(lines: SpendLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.egp, 0) * 100) / 100;
}

/** Spend grouped by one dimension, largest first (years in date order). */
export function groupSpend(lines: SpendLine[], dim: SpendDim): SpendGroup[] {
  const total = spendTotal(lines);
  const groups = new Map<string, SpendGroup>();
  for (const l of lines) {
    const k = keyOf(l, dim);
    const g = groups.get(k.key) ?? { ...k, egp: 0, share: 0, lines: 0, ...(dim === "currency" ? { original: 0 } : {}) };
    g.egp += l.egp; g.lines += l.lines;
    if (g.original != null) g.original += l.amount;
    groups.set(k.key, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, egp: Math.round(g.egp * 100) / 100, share: total > 0 ? g.egp / total : 0 }));
  return dim === "year" ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.egp - a.egp || a.label.localeCompare(b.label));
}

/** The `n` largest groups, the rest added up as one "Other" group (only when there is more than one left over). */
export function topN(groups: SpendGroup[], n: number): SpendGroup[] {
  const sorted = [...groups].sort((a, b) => b.egp - a.egp);
  if (n <= 0 || sorted.length <= n + 1) return sorted;
  const rest = sorted.slice(n);
  const other: SpendGroup = {
    key: "other", label: `Other (${rest.length})`, id: null,
    egp: Math.round(rest.reduce((s, g) => s + g.egp, 0) * 100) / 100,
    share: rest.reduce((s, g) => s + g.share, 0),
    lines: rest.reduce((s, g) => s + g.lines, 0),
  };
  return [...sorted.slice(0, n), other];
}

/** Share of spend held by the `n` largest groups (concentration), 0–1; null with no spend. */
export function topShare(groups: SpendGroup[], n: number): number | null {
  const total = groups.reduce((s, g) => s + g.egp, 0);
  if (!(total > 0)) return null;
  return [...groups].sort((a, b) => b.egp - a.egp).slice(0, n).reduce((s, g) => s + g.egp, 0) / total;
}

export function parseBasis(v: unknown): SpendBasis {
  return v === "invoice" ? "invoice" : "po";
}

export function parseDim(v: unknown): SpendDim {
  return SPEND_DIMS.some((d) => d.id === v) ? (v as SpendDim) : "supplier";
}

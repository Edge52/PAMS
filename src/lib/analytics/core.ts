/**
 * Analytics (wave 40): the shared ground every Analytics tab stands on. Pure, so the tabs, the export and the tests
 * agree. Each tab lives at `/analytics/<id>`; its page reads the filters with `parseFilters(searchParams)`, works out
 * its figures in a pure module under `lib/analytics/`, and shows every KPI with its formula, period and count
 * (`Kpi`). Comparisons with fewer than `MIN_N` items are hidden (`comparable`), and figures across hospitals are
 * shown per bed, per device or per 1,000 exams, never as raw totals.
 */
import type { Permission } from "@/lib/auth/permissions";

export type AnalyticsTabId =
  | "overview" | "maintenance" | "cost" | "procurement" | "budget" | "imaging" | "lifecycle" | "compare" | "export";

export type AnalyticsTab = { id: AnalyticsTabId; label: string; href: string; need: Permission; blurb: string };

/** Every tab, in menu order. Data quality has its own page (`/reports/data-quality`) and is linked from Overview. */
export const ANALYTICS_TABS: AnalyticsTab[] = [
  { id: "overview", label: "Overview", href: "/analytics", need: "reports.view", blurb: "The main figures on one page." },
  { id: "maintenance", label: "Maintenance", href: "/analytics/maintenance", need: "reports.view", blurb: "Uptime, failures, repair times and planned maintenance." },
  { id: "cost", label: "Cost", href: "/analytics/cost", need: "prices.view", blurb: "Spend by supplier, category and department; service cost against purchase value." },
  { id: "procurement", label: "Procurement", href: "/analytics/procurement", need: "prices.view", blurb: "Competition, cycle times, prices against earlier awards, supplier scores." },
  { id: "budget", label: "Budget", href: "/analytics/budget", need: "prices.view", blurb: "Budget used so far and the year-end forecast." },
  { id: "imaging", label: "Imaging", href: "/analytics/imaging", need: "reports.view", blurb: "Exams by hour and day, and idle scanner time." },
  { id: "lifecycle", label: "Lifecycle & risk", href: "/analytics/lifecycle", need: "reports.view", blurb: "Replacement waves and what-if capital plans." },
  { id: "compare", label: "Compare hospitals", href: "/analytics/compare", need: "reports.view", blurb: "The same figures side by side, per bed or per device." },
  { id: "export", label: "Export", href: "/analytics/export", need: "reports.view", blurb: "Download the figures, or connect Power BI to the read-only views." },
];

/** Hide a comparison or a ranking when it rests on fewer items than this. */
export const MIN_N = 5;

export function comparable(n: number, min = MIN_N): boolean {
  return Number.isFinite(n) && n >= min;
}

/** A figure with what it rests on: shown under every KPI so readers can judge it. */
export type Kpi = {
  label: string;
  value: number | null;
  /** How to show it: a share (0–1), a number, days, hours or money in EGP. */
  unit: "share" | "number" | "days" | "hours" | "egp";
  /** Plain-words formula, e.g. "Hours in service ÷ hours in the period". */
  formula: string;
  /** How many items it is worked out from. */
  n: number;
  /** Optional benchmark to compare against, with its source. */
  benchmark?: { text: string; source: string };
};

export type Filters = {
  facilityId: number | null;
  departmentId: number | null;
  deviceTypeId: number | null;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  from: string;
  to: string;
};

type Params = Record<string, string | string[] | undefined>;

function one(p: Params, k: string): string | undefined {
  const v = p[k];
  return Array.isArray(v) ? v[0] : v;
}

function id(p: Params, k: string): number | null {
  const n = Number(one(p, k));
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Read the shared filters from a page's search params. The period defaults to the 12 months up to `today`. */
export function parseFilters(p: Params, today: string): Filters {
  const to = ISO.test(one(p, "to") ?? "") ? one(p, "to")! : today;
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  d.setUTCDate(d.getUTCDate() + 1);
  const fallback = d.toISOString().slice(0, 10);
  let from = ISO.test(one(p, "from") ?? "") ? one(p, "from")! : fallback;
  if (from > to) from = fallback;
  return { facilityId: id(p, "facilityId"), departmentId: id(p, "departmentId"), deviceTypeId: id(p, "deviceTypeId"), from, to };
}

/** The filters as a query string, for links between tabs and to the export. */
export function filterQuery(f: Filters): string {
  const q = new URLSearchParams();
  if (f.facilityId) q.set("facilityId", String(f.facilityId));
  if (f.departmentId) q.set("departmentId", String(f.departmentId));
  if (f.deviceTypeId) q.set("deviceTypeId", String(f.deviceTypeId));
  q.set("from", f.from);
  q.set("to", f.to);
  return q.toString();
}

/** Days in the period, both ends included. */
export function periodDays(f: Pick<Filters, "from" | "to">): number {
  return Math.round((Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** A value per unit (per bed, per device, per 1,000 exams), or null when there is nothing to divide by. */
export function perUnit(value: number, units: number, scale = 1): number | null {
  return units > 0 ? (value / units) * scale : null;
}

export function median(xs: number[]): number | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation. */
export function mad(xs: number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Robust outlier score for `x` against `xs`: (x − median) ÷ (1.4826 × MAD). Above 3.5 is usually flagged (Iglewicz and
 * Hoaglin). Null when there are fewer than `MIN_N` values or they don't vary.
 */
export function robustZ(x: number, xs: number[]): number | null {
  if (!comparable(xs.length)) return null;
  const m = median(xs);
  const d = mad(xs);
  if (m == null || d == null || d === 0) return null;
  return (x - m) / (1.4826 * d);
}

export const OUTLIER_Z = 3.5;

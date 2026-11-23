/**
 * Budget (fiscal) years (wave 38, audit "missing features" 11). Egypt's fiscal year runs 1 July to 30 June, so the
 * default start month is July; Administration › Settings › "Budget year starts in" can change it.
 *
 * Storage: budget_lines.year and capital_budgets.year keep one integer, the calendar year in which the budget year
 * STARTS. With a July start, a stored 2026 is FY 2026/27 (1 Jul 2026 – 30 Jun 2027); with a January start it is
 * plain 2026, exactly as before wave 38. So existing "2026" budgets now read as FY 2026/27.
 *
 * Pure (no imports from "@/"), so it is safe in tests, client and server code. Dates are Cairo calendar dates
 * ("YYYY-MM-DD", from todayISO()); a Date is read in Cairo time.
 */

const CAIRO = "Africa/Cairo";
export const DEFAULT_BUDGET_START_MONTH = 7;
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** A start month from any input: a whole number 1–12, else July. */
export function cleanStartMonth(m: unknown): number {
  const n = Number(m);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_BUDGET_START_MONTH;
}

function cairoParts(d: Date): { y: number; m: number } {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) };
}

/** The budget year (its start year, as stored) a date falls in. "2026-06-30" → 2025 and "2026-07-01" → 2026 with July. */
export function fiscalYearOf(date: string | Date, startMonth: number = DEFAULT_BUDGET_START_MONTH): number {
  const start = cleanStartMonth(startMonth);
  let y: number, m: number;
  if (typeof date === "string") {
    const hit = /^(\d{4})-(\d{2})/.exec(date);
    if (!hit) throw new Error(`Not a date: ${date}`);
    y = Number(hit[1]); m = Number(hit[2]);
  } else ({ y, m } = cairoParts(date));
  return m >= start ? y : y - 1;
}

/** "FY 2026/27" (or "FY 2026" when the budget year is the calendar year, or "FY 2099/00" across a century). */
export function fiscalYearLabel(year: number, startMonth: number = DEFAULT_BUDGET_START_MONTH): string {
  if (cleanStartMonth(startMonth) === 1) return `FY ${year}`;
  return `FY ${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}

/** The stored start year from a label: "FY 2026/27", "2026/27", "2026/2027", "2026-27" or "2026". Null if unreadable. */
export function parseFiscalYear(label: string | number | null | undefined): number | null {
  if (label == null) return null;
  const s = String(label).trim().replace(/^FY\s*/i, "");
  const hit = /^(\d{4})(?:\s*[/-]\s*(\d{2}|\d{4}))?$/.exec(s);
  if (!hit) return null;
  const y = Number(hit[1]);
  if (y < 1900 || y > 2200) return null;
  if (hit[2]) {
    const end = hit[2].length === 2 ? (y + 1) % 100 : y + 1;
    if (Number(hit[2]) !== end) return null; // "2026/28" is not a budget year
  }
  return y;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First and last day of a budget year, from its label or stored year. Null when the label is unreadable. */
export function fiscalYearRange(label: string | number, startMonth: number = DEFAULT_BUDGET_START_MONTH): { year: number; label: string; start: string; end: string } | null {
  const year = parseFiscalYear(label);
  if (year == null) return null;
  const s = cleanStartMonth(startMonth);
  const endMonth = s === 1 ? 12 : s - 1;
  const endYear = s === 1 ? year : year + 1;
  return { year, label: fiscalYearLabel(year, s), start: iso(year, s, 1), end: iso(endYear, endMonth, lastDay(endYear, endMonth)) };
}

/** Year choices for a picker: last year to two years ahead, plus any stored year outside that span. */
export function fiscalYearOptions(current: number, startMonth: number = DEFAULT_BUDGET_START_MONTH, extra: number[] = []): { value: number; label: string }[] {
  const years = new Set([current - 1, current, current + 1, current + 2, ...extra.filter((y) => Number.isInteger(y))]);
  return [...years].sort((a, b) => a - b).map((y) => ({ value: y, label: fiscalYearLabel(y, startMonth) }));
}

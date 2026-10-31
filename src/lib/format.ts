/** Formatting + money helpers shared by all modules. Pure functions — safe on server and client. */

/** numeric columns come back from Postgres as strings; normalise to number (null-safe). */
export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals, avoiding binary float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Line total = qty × unit price × (1 − discount%). */
export function lineTotal(qty: number, unitPrice: string | number | null, discountPct = 0): number {
  return round2(qty * num(unitPrice) * (1 - (discountPct || 0) / 100));
}

export function formatMoney(v: string | number | null | undefined, currency = "USD", opts?: { compact?: boolean }): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = num(v);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency, maximumFractionDigits: opts?.compact ? 1 : 2,
      notation: opts?.compact ? "compact" : "standard",
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  }
}

export function formatNumber(v: string | number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || v === "") return "—";
  return num(v).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** Dates: "2026-10-27" or Date → "27 Oct 2026". */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? v + "T00:00:00" : v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Today as YYYY-MM-DD (for date inputs and date columns). */
/**
 * The hospital's time zone. Dates without a time (delivery dates, due dates, "today") are in this zone,
 * not the server's — a server in UTC would otherwise think it's still yesterday until 2–3 am in Cairo.
 */
export const APP_TIME_ZONE = process.env.NEXT_PUBLIC_APP_TIME_ZONE || "Africa/Cairo";

/** Today as YYYY-MM-DD in the hospital's time zone (for date inputs and date columns). */
export function todayISO(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Timestamps in the hospital's time zone: Date → "27 Oct 2026, 14:05". */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Add months to a YYYY-MM-DD date, clamping to the end of the month (31 Aug + 6 → 28/29 Feb, not 3 Mar). */
export function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Days from today until a date (negative = past). */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso + "T00:00:00").getTime();
  return Math.round((t - new Date(todayISO() + "T00:00:00").getTime()) / 86_400_000);
}

export const CURRENCIES = ["USD", "EUR", "EGP", "GBP", "CNY", "JPY"] as const;

/** Add days to a YYYY-MM-DD date string (negative to go back). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

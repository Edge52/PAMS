/** Pure ISO-date helpers (YYYY-MM-DD, UTC based) for asset scheduling. Safe on server and client. */

export function parseISO(iso: string): Date {
  return new Date(iso.slice(0, 10) + "T00:00:00Z");
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isISODate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = parseISO(v);
  return !Number.isNaN(d.getTime()) && toISO(d) === v;
}

/**
 * Add months, clamping to the last day of the target month (31 Jan + 1 month → 28/29 Feb, not 3 Mar). This is the one
 * month-add for asset dates (PPM, safety tests, warranty, training). For a repeating cycle use `addMonthsSeries`, which
 * counts every step from the first date so a 31st does not slide to the 28th for good after February.
 */
export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toISO(target);
}

/** The k-th date of a cycle of `months` months from `anchor` (k = 0 is the anchor), clamped to month ends. */
export function addMonthsSeries(anchor: string, months: number, k: number): string {
  return addMonths(anchor, months * k);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/** "2026-10-27" → "2026-10" */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-10" → "October 2026" */
export function monthLabel(key: string): string {
  const d = parseISO(key + "-01");
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 7) + "-01";
}

export function endOfMonth(iso: string): string {
  return addDays(addMonths(startOfMonth(iso), 1), -1);
}

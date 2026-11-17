/**
 * Usage meters and usage-based planned maintenance (wave 27). Pure.
 *
 * Some planned maintenance falls due by use rather than by months: a CT tube every so many scans, a ventilator every
 * so many hours, a dialysis machine every so many cycles. A device type may carry a usage interval and unit; the
 * device's meter readings give the use so far, and the average use per day gives the date the interval runs out.
 * Planned maintenance is then due on whichever comes first: the months interval (`nextPpmDue`) or this date.
 *
 * Rules
 * - Readings never go backwards, except at a RESET row: the first reading of a new or reset meter.
 * - Use is counted from the last completed PPM (else installation). When that date is before the first reading, the
 *   count starts at the first reading (record a reading at each PPM for an exact count).
 * - Average use per day: from the readings in the last 180 days before the latest reading (at least one day apart),
 *   else over all readings. No use recorded means no usage-based date.
 */
import { addDays, daysBetween } from "./dates";

export const USAGE_UNITS = ["hours", "scans", "cycles", "exposures", "procedures"] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];
export const USAGE_UNIT_LABELS: Record<UsageUnit, string> = {
  hours: "Hours run", scans: "Scans or exams", cycles: "Cycles or treatments", exposures: "Exposures", procedures: "Procedures",
};
/** Imaging use (monthly exam counts, wave 9) counts as a meter in this unit when a device has no readings of its own. */
export const IMAGING_UNIT: UsageUnit = "scans";
export const RATE_WINDOW_DAYS = 180;

export type MeterKind = "READING" | "RESET";
export type MeterReading = { readOn: string; reading: number; kind: MeterKind; id?: number };
/** Use counted from the first reading, carried across meter resets. */
export type UsagePoint = { date: string; total: number };

const byDate = <T extends { readOn: string; id?: number }>(rs: T[]): T[] =>
  [...rs].sort((a, b) => a.readOn.localeCompare(b.readOn) || (a.id ?? 0) - (b.id ?? 0));

/** Why a new reading can't be saved among the existing ones, or null. */
export function readingProblem(existing: MeterReading[], next: MeterReading): string | null {
  if (!Number.isFinite(next.reading) || next.reading < 0) return "Enter the meter reading as a number, 0 or more.";
  const all = byDate([...existing.map((r, i) => ({ ...r, id: r.id ?? i })), { ...next, id: Number.MAX_SAFE_INTEGER }]);
  const at = all.findIndex((r) => r.id === Number.MAX_SAFE_INTEGER);
  const before = all[at - 1], after = all[at + 1];
  if (next.kind === "READING" && before && next.reading < before.reading) {
    return `The meter read ${before.reading} on ${before.readOn}. A reading can't go backwards: if the meter was reset or replaced, record it as a new meter.`;
  }
  if (after && after.kind === "READING" && after.reading < next.reading) {
    return `A later reading (${after.reading} on ${after.readOn}) is lower than this one. Check the date and the figure.`;
  }
  return null;
}

/** Readings → cumulative use since the first reading. A RESET adds no use for its own step (the old meter's last
 *  figure should be recorded as a normal reading first). Readings on the same day keep the latest total. */
export function usagePoints(readings: MeterReading[]): UsagePoint[] {
  const out: UsagePoint[] = [];
  let total = 0, prev: MeterReading | null = null;
  for (const r of byDate(readings)) {
    if (prev && r.kind === "READING") total += Math.max(0, r.reading - prev.reading);
    prev = r;
    if (out.length && out[out.length - 1].date === r.readOn) out[out.length - 1].total = total;
    else out.push({ date: r.readOn, total });
  }
  return out;
}

/** Use at a date, by straight line between the points around it (clamped to the first and last point). */
export function usageAt(points: UsagePoint[], date: string): number {
  if (!points.length) return 0;
  if (date <= points[0].date) return points[0].total;
  const last = points[points.length - 1];
  if (date >= last.date) return last.total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (date <= b.date) {
      const span = daysBetween(a.date, b.date);
      return span <= 0 ? b.total : a.total + ((b.total - a.total) * daysBetween(a.date, date)) / span;
    }
  }
  return last.total;
}

/** Average use per day, or null when the readings don't span a day. */
export function averageDailyUse(points: UsagePoint[], windowDays = RATE_WINDOW_DAYS): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const from = addDays(last.date, -windowDays);
  // The latest point at or before the window start, so the window is covered; else the first point.
  let start = points[0];
  for (const p of points) if (p.date <= from) start = p;
  const days = daysBetween(start.date, last.date);
  if (days < 1) return null;
  return (last.total - start.total) / days;
}

export type UsageDue = {
  unit: string;
  interval: number;
  /** Use since the last PPM (or installation), and what is left before the next. */
  usedSince: number;
  remaining: number;
  perDay: number | null;
  lastReading: { date: string; reading: number } | null;
  /** When usage-based PPM falls due; null without readings or without use. */
  due: string | null;
  countedFrom: "last_ppm" | "install" | "first_reading" | "none";
};

/** When planned maintenance falls due by use. */
export function usagePpmDue(a: {
  readings: MeterReading[]; interval: number; unit: string; lastPpmDate?: string | null; installDate?: string | null;
}): UsageDue {
  const points = usagePoints(a.readings);
  const sorted = byDate(a.readings);
  const lastRaw = sorted[sorted.length - 1];
  const base: UsageDue = { unit: a.unit, interval: a.interval, usedSince: 0, remaining: a.interval, perDay: null, lastReading: lastRaw ? { date: lastRaw.readOn, reading: lastRaw.reading } : null, due: null, countedFrom: "none" };
  if (!points.length || !(a.interval > 0)) return base;
  const since = a.lastPpmDate ?? a.installDate ?? null;
  const countedFrom: UsageDue["countedFrom"] = !since || since < points[0].date ? "first_reading" : a.lastPpmDate ? "last_ppm" : "install";
  const startTotal = since ? usageAt(points, since) : points[0].total;
  const last = points[points.length - 1];
  const usedSince = Math.max(0, last.total - startTotal);
  const remaining = a.interval - usedSince;
  const perDay = averageDailyUse(points);
  let due: string | null = null;
  if (remaining <= 0) {
    // Already used up: the day the count crossed the interval, from the readings.
    const target = startTotal + a.interval;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i];
      if (q.total >= target && (!since || q.date >= since)) {
        const span = daysBetween(p.date, q.date), gain = q.total - p.total;
        due = gain > 0 && span > 0 ? addDays(p.date, Math.max(0, Math.ceil(((target - p.total) / gain) * span))) : q.date;
        if (since && due < since) due = since;
        break;
      }
    }
    due ??= last.date;
  } else if (perDay && perDay > 0) {
    due = addDays(last.date, Math.ceil(remaining / perDay));
  }
  return { ...base, usedSince, remaining, perDay, due, countedFrom };
}

/**
 * Monthly exam counts (imaging use) as meter readings: 0 on the first day of the first month, then the running total
 * on the last day of each month (no later than today). Months must be "YYYY-MM-01".
 */
export function readingsFromMonthlyCounts(rows: { month: string; exams: number }[], today: string): MeterReading[] {
  const sorted = [...rows].filter((r) => r.exams >= 0).sort((a, b) => a.month.localeCompare(b.month));
  if (!sorted.length) return [];
  const out: MeterReading[] = [{ readOn: sorted[0].month.slice(0, 10), reading: 0, kind: "READING" }];
  let total = 0;
  for (const r of sorted) {
    total += r.exams;
    const d = new Date(`${r.month.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    const end = d.toISOString().slice(0, 10);
    out.push({ readOn: end > today ? today : end, reading: total, kind: "READING" });
  }
  return out;
}

/** "every 5,000 hours" */
export function usageIntervalLabel(interval: number | null | undefined, unit: string | null | undefined): string | null {
  if (!interval || interval <= 0 || !unit) return null;
  return `every ${interval.toLocaleString("en-GB")} ${unit}`;
}

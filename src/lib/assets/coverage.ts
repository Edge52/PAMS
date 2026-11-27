/**
 * Contract covered hours (wave 38, audit #12). Pure.
 *
 * Many service contracts guarantee uptime only in agreed hours, for example Sunday to Thursday 08:00–20:00 Cairo time,
 * not on public holidays. The covered hours of a period are built day by day in the hospital's time zone (Egypt keeps
 * summer time again since 2023, so the offset comes from Intl with Africa/Cairo, never a fixed +2), then downtime is
 * merged per device and cut to those hours.
 *
 * Rules
 * - No coverage set, or "24/7": every hour counts (the statement is the same as before wave 38).
 * - A shift whose end is at or before its start runs overnight and ends the next day (22:00–06:00). It belongs to the
 *   day it starts on: that day must be a covered weekday and not a holiday.
 * - "24:00" as the end means midnight at the end of the day. From = to ("08:00–08:00") is a full 24-hour shift.
 * - A holiday removes the shifts that start on it.
 */
import { mergeIntervals, type DownPeriod } from "./downtime";
import { addDays, parseISO } from "./dates";
import { zonedInstant } from "../format";

export type Coverage = {
  allHours: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  fromTime: string;
  toTime: string;
  excludeHolidays: boolean;
};
export type Interval = [number, number];

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
/** The usual Egyptian working week for a supplier's engineers. */
export const DEFAULT_COVERAGE: Coverage = { allHours: false, days: [0, 1, 2, 3, 4], fromTime: "08:00", toTime: "20:00", excludeHolidays: true };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Why these covered hours can't be saved, or null. */
export function coverageProblem(c: Coverage): string | null {
  if (c.allHours) return null;
  if (!c.days.length) return "Choose at least one covered day, or tick round the clock.";
  if (c.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "Days must be Sunday to Saturday.";
  if (!TIME.test(c.fromTime)) return "Enter the start time as HH:MM, for example 08:00.";
  if (!END_TIME.test(c.toTime)) return "Enter the end time as HH:MM, for example 20:00 (24:00 for midnight).";
  return null;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Hours of one shift (overnight and equal times handled as in the rules). */
export function shiftHours(c: Pick<Coverage, "fromTime" | "toTime">): number {
  const a = minutes(c.fromTime), b = minutes(c.toTime);
  return (b > a ? b - a : b + 1440 - a) / 60;
}

/** "Sun–Thu 08:00–20:00, not on public holidays" / "Round the clock". */
export function coverageLabel(c: Coverage | null | undefined): string {
  if (!c || c.allHours) return "Round the clock (24/7)";
  const days = [...new Set(c.days)].sort((a, b) => a - b);
  // Runs of consecutive days (Sun–Thu), else a list.
  const runs: number[][] = [];
  for (const d of days) { const r = runs.at(-1); if (r && d === r[r.length - 1] + 1) r.push(d); else runs.push([d]); }
  const dayText = days.length === 7 ? "Every day" : runs.map((r) => (r.length > 2 ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r.at(-1)!]}` : r.map((d) => DAY_SHORT[d]).join(", "))).join(", ");
  const over = minutes(c.toTime) <= minutes(c.fromTime) ? " (overnight)" : "";
  return `${dayText} ${c.fromTime}–${c.toTime}${over}${c.excludeHolidays ? ", not on public holidays" : ""}`;
}

/** The weekday (0 = Sunday) of a local calendar date. */
export const weekday = (iso: string) => parseISO(iso).getUTCDay();

/** The local (time zone) calendar date of an instant. */
export function localDate(t: Date | number, timeZone = "Africa/Cairo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/**
 * The covered intervals between `from` and `to` (ms, sorted, disjoint). Round the clock gives the whole window.
 * `holidays` are local dates (YYYY-MM-DD).
 */
export function coveredIntervals(c: Coverage | null | undefined, holidays: Iterable<string>, from: Date, to: Date, timeZone = "Africa/Cairo"): Interval[] {
  const f = from.getTime(), t = to.getTime();
  if (!(t > f)) return [];
  if (!c || c.allHours) return [[f, t]];
  const days = new Set(c.days), off = c.excludeHolidays ? new Set(holidays) : new Set<string>();
  const overnight = minutes(c.toTime) <= minutes(c.fromTime);
  const out: Interval[] = [];
  // Start a day early: an overnight shift from the day before can reach into the window.
  for (let d = addDays(localDate(f, timeZone), -1), last = localDate(t, timeZone); d <= last; d = addDays(d, 1)) {
    if (!days.has(weekday(d)) || off.has(d)) continue;
    const a = zonedInstant(d, c.fromTime, timeZone).getTime();
    const endDay = overnight || c.toTime === "24:00" ? addDays(d, 1) : d;
    const b = zonedInstant(endDay, c.toTime === "24:00" ? "00:00" : c.toTime, timeZone).getTime();
    const lo = Math.max(a, f), hi = Math.min(b, t);
    if (hi > lo) out.push([lo, hi]);
  }
  return mergeIntervals(out);
}

/** Total length of disjoint intervals, ms. */
export const totalMs = (list: Interval[]) => list.reduce((s, [a, b]) => s + (b - a), 0);

/** The overlap of two sorted, disjoint interval lists. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]), hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

/**
 * Downtime of one device inside the covered intervals: periods clipped to the window (an open one runs to `to`),
 * merged, then cut to the covered hours. Same as `downtimeMs` when `covered` is the whole window.
 */
export function coveredDowntimeMs(periods: DownPeriod[], covered: Interval[], from: Date, to: Date): number {
  const f = from.getTime(), t = to.getTime();
  const down = mergeIntervals(periods.map((p): Interval => [Math.max(p.start.getTime(), f), Math.min((p.end ?? to).getTime(), t)]));
  return totalMs(intersectIntervals(down, covered));
}

/** As `coveredDowntimeMs` for many devices: merged per device, then added up per device. */
export function coveredDowntimeByDevice<K>(periods: (DownPeriod & { device: K })[], covered: Interval[], from: Date, to: Date): Map<K, number> {
  const by = new Map<K, DownPeriod[]>();
  for (const p of periods) (by.get(p.device) ?? by.set(p.device, []).get(p.device)!).push(p);
  return new Map([...by].map(([k, ps]) => [k, coveredDowntimeMs(ps, covered, from, to)]));
}

/** Holidays inside a date range (inclusive), for showing on a statement. */
export function holidaysIn<T extends { day: string }>(list: T[], fromISO: string, toISO: string): T[] {
  return list.filter((h) => h.day >= fromISO && h.day <= toISO).sort((a, b) => a.day.localeCompare(b.day));
}


/**
 * Wave 41: hours between two instants that fall inside the covered intervals (response and repair times "in
 * covered hours"). `covered` must span the whole job; outside it nothing counts.
 */
export function coveredHoursBetween(covered: Interval[], a: Date, b: Date): number {
  if (!(b.getTime() > a.getTime())) return 0;
  return totalMs(intersectIntervals([[a.getTime(), b.getTime()]], covered)) / 3_600_000;
}

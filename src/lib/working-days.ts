/**
 * Working days (wave 43), the one place every working-day count in PAMS goes through. Pure: safe on server, client
 * and in tests (working-days.test.ts).
 *
 *  - Egypt's weekend is Friday and Saturday.
 *  - Public holidays are the hospital's own list (Setup › Public holidays, `lib/holidays-server.ts` reads it). A
 *    holiday with no hospital applies to every hospital; one with a hospital only to that hospital.
 *  - Islamic holidays move each year with the moon: there is no built-in list, the hospital enters the dates.
 */

/** 0 = Sunday … 6 = Saturday. */
export const WEEKEND_DAYS: readonly number[] = [5, 6];

/** Holiday dates as ISO strings ("2026-10-06"). An array or a set. */
export type HolidayDates = readonly string[] | ReadonlySet<string>;

/** Whether a date is on the holiday list. */
export const isHoliday = (h: HolidayDates, iso: string) => (Array.isArray(h) ? (h as readonly string[]).includes(iso) : (h as ReadonlySet<string>).has(iso));

/** 0 = Sunday … 6 = Saturday, for an ISO date. */
export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export const isWeekend = (iso: string) => WEEKEND_DAYS.includes(weekdayOf(iso));

export function isWorkingDay(iso: string, holidays: HolidayDates = []): boolean {
  return !isWeekend(iso) && !isHoliday(holidays, iso);
}

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Working days after `fromISO` up to and including `toISO` (0 when toISO is not later). */
export function workingDaysBetween(fromISO: string, toISO: string, holidays: HolidayDates = []): number {
  if (toISO <= fromISO) return 0;
  let n = 0;
  // Bounded: at most ten years of days.
  for (let d = nextDay(fromISO), i = 0; d <= toISO && i < 3660; d = nextDay(d), i++) if (isWorkingDay(d, holidays)) n++;
  return n;
}

/** The date `n` working days after `fromISO` (`fromISO` itself when n is 0). */
export function addWorkingDays(fromISO: string, n: number, holidays: HolidayDates = []): string {
  let d = fromISO;
  for (let left = Math.max(0, Math.floor(n)), i = 0; left > 0 && i < 3660; i++) { d = nextDay(d); if (isWorkingDay(d, holidays)) left--; }
  return d;
}

/** The first working day on or after `iso`. */
export function nextWorkingDay(iso: string, holidays: HolidayDates = []): string {
  let d = iso;
  for (let i = 0; !isWorkingDay(d, holidays) && i < 3660; i++) d = nextDay(d);
  return d;
}

/** The dates that count as holidays for one hospital: the group-wide ones and its own. `null` = group-wide only. */
export function holidaysOf(rows: readonly { day: string; facilityId: number | null }[], facilityId: number | null): Set<string> {
  return new Set(rows.filter((r) => r.facilityId == null || (facilityId != null && r.facilityId === facilityId)).map((r) => r.day));
}

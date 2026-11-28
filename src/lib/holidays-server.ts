import "server-only";
/**
 * Public holidays (wave 43), database side. Rules are pure in ./working-days. Reads the Setup list (`holidays`, with
 * or without a hospital) and the older contract list (`public_holidays`, wave 38) until its rows are moved. Tolerates
 * a database without the wave 43 table (older installs and tests keep working on weekends only).
 */
import { and, asc, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { holidays, publicHolidays } from "@/db/schema";
import { holidaysOf } from "./working-days";

export type HolidayRow = { day: string; name: string; facilityId: number | null; moves: boolean };

const MAX_ROWS = 5000;
/** A database without the table yet (same test as notifications/prefs-server, kept here to stay light). */
const isMissingTable = (e: unknown) => ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "42P01";

/**
 * Holidays between two dates (both included), oldest first. `facilityIds` = the hospitals asked about (group-wide
 * holidays always come too); `null` = every hospital.
 */
export async function holidayRows(facilityIds: readonly number[] | null, from: string, to: string): Promise<HolidayRow[]> {
  const out: HolidayRow[] = [];
  try {
    const rows = await db.select({ day: holidays.day, name: holidays.name, facilityId: holidays.facilityId, moves: holidays.moves }).from(holidays)
      .where(and(gte(holidays.day, from), lte(holidays.day, to),
        facilityIds === null ? undefined : facilityIds.length ? or(isNull(holidays.facilityId), inArray(holidays.facilityId, [...facilityIds])) : isNull(holidays.facilityId)))
      .orderBy(asc(holidays.day)).limit(MAX_ROWS);
    out.push(...rows);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  if (facilityIds === null || facilityIds.length) {
    try {
      const old = await db.select({ day: publicHolidays.day, name: publicHolidays.name, facilityId: publicHolidays.facilityId, approximate: publicHolidays.approximate }).from(publicHolidays)
        .where(and(gte(publicHolidays.day, from), lte(publicHolidays.day, to), facilityIds === null ? undefined : inArray(publicHolidays.facilityId, [...facilityIds])))
        .orderBy(asc(publicHolidays.day)).limit(MAX_ROWS);
      const seen = new Set(out.map((r) => `${r.facilityId ?? 0}:${r.day}`));
      for (const r of old) if (!seen.has(`${r.facilityId}:${r.day}`)) out.push({ day: r.day, name: r.name, facilityId: r.facilityId, moves: r.approximate });
    } catch (e) {
      if (!isMissingTable(e)) throw e;
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Holiday dates for one hospital (group-wide and its own); `null` = group-wide only. */
export async function holidayDates(facilityId: number | null, from: string, to: string): Promise<Set<string>> {
  return holidaysOf(await holidayRows(facilityId == null ? [] : [facilityId], from, to), facilityId);
}

/** Holiday dates per hospital for a batch (one read). Look up a hospital not asked about with `holidaysOf(rows, id)`. */
export async function holidayDatesBy(facilityIds: readonly (number | null)[], from: string, to: string): Promise<(facilityId: number | null) => Set<string>> {
  const ids = [...new Set(facilityIds.filter((f): f is number => f != null))];
  const rows = await holidayRows(ids, from, to);
  const cache = new Map<number, Set<string>>();
  return (f) => {
    const k = f ?? 0;
    if (!cache.has(k)) cache.set(k, holidaysOf(rows, f));
    return cache.get(k)!;
  };
}

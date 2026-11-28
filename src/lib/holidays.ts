/**
 * Public holidays list (wave 43): the import template, row checks and "copy last year". Pure (holidays.test.ts).
 * Working-day rules are in ./working-days. There is no built-in list: Islamic holidays move each year with the moon,
 * and the government often moves a fixed one to a Thursday or Sunday, so the hospital enters the dates.
 */
import { cellText, dateCell, textCell, yesNoCell, type Column } from "./imports/table";

export const HOLIDAY_COLUMNS: Column<"day" | "name" | "hospital" | "moves">[] = [
  { key: "day", header: "Date", required: true, hint: "The day off, YYYY-MM-DD or DD/MM/YYYY", example: "2027-01-07", aliases: ["Day"] },
  { key: "name", header: "Holiday", required: true, hint: "Its name", example: "Coptic Christmas", aliases: ["Name"] },
  { key: "hospital", header: "Hospital", hint: "Hospital code or name. Blank: every hospital", example: "", aliases: ["Facility"] },
  { key: "moves", header: "Moves each year", hint: "Yes for a holiday whose date changes every year (Eid, Islamic New Year, the Prophet's Birthday). Blank: No", example: "No", aliases: ["Moves"] },
];

export type HolidayInput = { day: string; name: string; facilityId: number | null; moves: boolean };
export type Hospital = { id: number; code: string; name: string };

const squash = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Same hospital and date: one holiday. */
export const holidayKey = (facilityId: number | null, day: string) => `${facilityId ?? 0}:${day}`;

/**
 * One imported row. `hospitals` are the ones this person may change; `allowAll` = may add holidays for every
 * hospital (no hospital limit on the account).
 */
export function checkHolidayRow(c: Record<string, unknown>, hospitals: readonly Hospital[], allowAll: boolean): { value: HolidayInput | null; errors: string[] } {
  const e: string[] = [];
  const day = dateCell(c.day, "Date", e, true);
  const name = textCell(c.name, "Holiday", e, 120, true);
  const moves = yesNoCell(c.moves, "Moves each year", e);
  const h = cellText(c.hospital);
  let facilityId: number | null = null;
  if (h) {
    const hit = hospitals.find((x) => squash(x.code) === squash(h) || squash(x.name) === squash(h));
    if (hit) facilityId = hit.id;
    else e.push(`No hospital “${h}” that you look after.`);
  } else if (!allowAll) e.push("Name the hospital: your account is limited to some hospitals.");
  return { value: e.length || !day || !name ? null : { day, name, facilityId, moves }, errors: e };
}

/** Years shown and copied are four digits. */
export const yearOf = (iso: string) => Number(iso.slice(0, 4));

/**
 * "Copy last year's fixed-date holidays": holidays of `fromYear` not marked as moving, on the same day and month one
 * year later. Dates already on the list (same hospital) and 29 February are left out.
 */
export function copyFixedHolidays(rows: readonly HolidayInput[], fromYear: number): HolidayInput[] {
  const have = new Set(rows.map((r) => holidayKey(r.facilityId, r.day)));
  const out: HolidayInput[] = [];
  for (const r of rows) {
    if (r.moves || yearOf(r.day) !== fromYear || r.day.slice(5) === "02-29") continue;
    const day = `${fromYear + 1}${r.day.slice(4)}`;
    const k = holidayKey(r.facilityId, day);
    if (have.has(k)) continue;
    have.add(k);
    out.push({ ...r, day });
  }
  return out;
}

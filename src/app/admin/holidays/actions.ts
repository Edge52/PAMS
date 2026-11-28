"use server";
/**
 * Public holidays (wave 43, Setup). Needs `settings.manage`. A holiday for one hospital needs access to it; a holiday
 * for every hospital needs an account with no hospital limit. Rules in lib/holidays.ts and lib/working-days.ts.
 */
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { facilities, holidays, publicHolidays } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { isISODate } from "@/lib/assets/dates";
import { formatDate } from "@/lib/format";
import { checkHolidayRow, copyFixedHolidays, HOLIDAY_COLUMNS, holidayKey, type HolidayInput } from "@/lib/holidays";
import { readUpload } from "@/lib/imports/read-server";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const PATH = "/admin/holidays";
const PERM = "settings.manage" as const;

const Schema = z.object({
  facilityId: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable()),
  day: z.string({ error: "Enter the date." }).trim().refine(isISODate, "Enter the date."),
  name: z.string({ error: "Enter the holiday's name." }).trim().min(1, "Enter the holiday's name.").max(120, "Keep the name under 120 characters."),
  moves: z.preprocess((v) => v === "on", z.boolean()),
});

/** May this person change holidays of this hospital (null = every hospital)? */
async function mayChange(facilityId: number | null, me: CurrentUser): Promise<string | null> {
  if (facilityId == null) return (await facilityScope(me)) === null ? null : "Your account is limited to some hospitals: choose one.";
  const [f] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.id, facilityId));
  if (!f) return "Choose a hospital.";
  await requireFacilityAccess(f.id, me);
  return null;
}

const sameScope = (facilityId: number | null) => (facilityId == null ? isNull(holidays.facilityId) : eq(holidays.facilityId, facilityId));

/** Write holidays: new dates added, a date already on the list (same hospital) renamed. Returns [added, renamed]. */
async function upsert(rows: HolidayInput[]): Promise<[number, number]> {
  if (!rows.length) return [0, 0];
  const days = rows.map((r) => r.day).sort();
  return db.transaction(async (tx) => {
    const have = await tx.select().from(holidays).where(and(gte(holidays.day, days[0]), lte(holidays.day, days.at(-1)!)));
    const byKey = new Map(have.map((h) => [holidayKey(h.facilityId, h.day), h]));
    let added = 0, renamed = 0;
    for (const r of rows) {
      const old = byKey.get(holidayKey(r.facilityId, r.day));
      if (old) {
        if (old.name === r.name && old.moves === r.moves) continue;
        await tx.update(holidays).set({ name: r.name, moves: r.moves }).where(eq(holidays.id, old.id));
        renamed++;
      } else {
        const [n] = await tx.insert(holidays).values(r).onConflictDoNothing().returning({ id: holidays.id });
        if (n) added++;
      }
    }
    return [added, renamed];
  });
}

/** Add a holiday, or rename one already on that date for the same hospital. */
export async function saveHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission(PERM);
  const p = Schema.safeParse({ facilityId: fd.get("facilityId"), day: fd.get("day"), name: fd.get("name"), moves: fd.get("moves") });
  if (!p.success) return zodFail(p.error);
  const why = await mayChange(p.data.facilityId, me);
  if (why) return fail(why);
  const [added] = await upsert([p.data]);
  const [h] = await db.select({ id: holidays.id }).from(holidays).where(and(sameScope(p.data.facilityId), eq(holidays.day, p.data.day)));
  if (h) await logActivity("holiday", h.id, added ? "holiday_added" : "holiday_saved", `Public holiday ${formatDate(p.data.day)}: ${p.data.name}`, me.name);
  revalidatePath(PATH);
  return { message: `${formatDate(p.data.day)} saved as ${p.data.name}.` };
}

export async function removeHolidayAction(fd: FormData): Promise<void> {
  const me = await requirePermission(PERM);
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const [h] = await db.select().from(holidays).where(eq(holidays.id, id));
  if (!h || (await mayChange(h.facilityId, me))) return;
  await db.delete(holidays).where(eq(holidays.id, id));
  await logActivity("holiday", h.id, "holiday_removed", `Public holiday removed: ${formatDate(h.day)} ${h.name}`, me.name);
  revalidatePath(PATH);
}

/** Import from the Excel or CSV template. Every row is checked first; nothing is written when a row is wrong. */
export async function importHolidaysAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission(PERM);
  const r = await readUpload(fd.get("file"), HOLIDAY_COLUMNS);
  if ("error" in r) return fail(r.error);
  const scope = await facilityScope(me);
  const hospitals = await db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities)
    .where(scope === null ? undefined : scope.length ? inArray(facilities.id, scope) : eq(facilities.id, -1));
  const errors: string[] = [];
  const rows: HolidayInput[] = [];
  const seen = new Set<string>();
  for (const row of r.rows) {
    const c = checkHolidayRow(row.cells, hospitals, scope === null);
    if (c.value && seen.has(holidayKey(c.value.facilityId, c.value.day))) c.errors.push("The same date is on an earlier row.");
    if (c.errors.length || !c.value) { errors.push(`Row ${row.rowNumber}: ${c.errors.join(" ")}`); continue; }
    seen.add(holidayKey(c.value.facilityId, c.value.day));
    rows.push(c.value);
  }
  if (errors.length) return fail(...errors.slice(0, 10), ...(errors.length > 10 ? [`And ${errors.length - 10} more rows to fix. Nothing was imported.`] : ["Nothing was imported."]));
  const [added, renamed] = await upsert(rows);
  if (added + renamed) await logActivity("holiday", 0, "holidays_imported", `${added} public holidays added and ${renamed} changed from ${r.fileName}`.slice(0, 600), me.name);
  revalidatePath(PATH);
  return { message: `${added} holiday${added === 1 ? "" : "s"} added${renamed ? `, ${renamed} changed` : ""}.${added + renamed ? "" : " Every row was already on the list."}` };
}

/** Copy one year's fixed-date holidays to the next year (holidays marked as moving are left out). */
export async function copyLastYearAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission(PERM);
  const year = Number(fd.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail("Choose the year to copy from.");
  const scope = await facilityScope(me);
  const rows = await db.select().from(holidays).where(and(gte(holidays.day, `${year}-01-01`), lte(holidays.day, `${year + 1}-12-31`),
    scope === null ? undefined : scope.length ? inArray(holidays.facilityId, scope) : eq(holidays.id, -1)));
  const copies = copyFixedHolidays(rows.map((h) => ({ day: h.day, name: h.name, facilityId: h.facilityId, moves: h.moves })), year);
  const [added] = await upsert(copies);
  if (added) await logActivity("holiday", 0, "holidays_copied", `${added} fixed-date public holidays copied from ${year} to ${year + 1}`, me.name);
  revalidatePath(PATH);
  return added
    ? { message: `${added} holiday${added === 1 ? "" : "s"} copied to ${year + 1}. Check them against the official announcements, and add the moving holidays (Eid and others) yourself.` }
    : { message: `Nothing to copy: ${year} has no fixed-date holidays missing from ${year + 1}.` };
}

/** Move the older contract holiday list (wave 38, one per hospital) into this list. */
export async function moveOldHolidaysAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission(PERM);
  void fd; // the form only confirms
  const scope = await facilityScope(me);
  const old = await db.select().from(publicHolidays).where(scope === null ? undefined : scope.length ? inArray(publicHolidays.facilityId, scope) : eq(publicHolidays.id, -1));
  if (!old.length) return { message: "Nothing left to move." };
  const [added, renamed] = await upsert(old.map((h) => ({ day: h.day, name: h.name, facilityId: h.facilityId, moves: h.approximate })));
  await db.delete(publicHolidays).where(inArray(publicHolidays.id, old.map((h) => h.id)));
  await logActivity("holiday", 0, "holidays_moved", `${old.length} contract holidays moved into the public holidays list`, me.name);
  revalidatePath(PATH);
  return { message: `${old.length} holiday${old.length === 1 ? "" : "s"} moved (${added} new, ${renamed} renamed).` };
}

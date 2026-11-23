"use server";
/** Wave 38: a hospital's public holidays, for contract covered hours. Needs `contracts.edit` and the hospital. */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { facilities, publicHolidays } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { EGYPT_HOLIDAYS_2026_2027 } from "@/lib/assets/holidays";
import { isISODate } from "@/lib/assets/dates";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { formatDate } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const PATH = "/assets/contracts/holidays";
const Schema = z.object({
  facilityId: z.coerce.number({ error: "Choose a hospital." }).int().positive("Choose a hospital."),
  day: z.string({ error: "Enter the date." }).trim().refine(isISODate, "Enter the date."),
  name: z.string({ error: "Enter the holiday's name." }).trim().min(1, "Enter the holiday's name.").max(120, "Keep the name under 120 characters."),
  approximate: z.preprocess((v) => v === "on", z.boolean()),
});

async function hospital(id: number, me: Awaited<ReturnType<typeof requirePermission>>) {
  const [f] = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(eq(facilities.id, id));
  if (f) await requireFacilityAccess(f.id, me);
  return f ?? null;
}

/** Add a holiday, or rename one already on that date. */
export async function saveHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("contracts.edit");
  const p = Schema.safeParse({ facilityId: fd.get("facilityId"), day: fd.get("day") ?? "", name: fd.get("name") ?? "", approximate: fd.get("approximate") });
  if (!p.success) return zodFail(p.error);
  const f = await hospital(p.data.facilityId, me);
  if (!f) return fail("Choose a hospital.");
  const v = { name: p.data.name, approximate: p.data.approximate };
  await db.insert(publicHolidays).values({ facilityId: f.id, day: p.data.day, ...v }).onConflictDoUpdate({ target: [publicHolidays.facilityId, publicHolidays.day], set: v });
  await logActivity("facility", f.id, "holiday_saved", `Public holiday ${formatDate(p.data.day)}: ${p.data.name}`, me.name);
  revalidatePath(PATH);
  return { message: `${formatDate(p.data.day)} saved as ${p.data.name}.` };
}

export async function removeHolidayAction(fd: FormData) {
  const me = await requirePermission("contracts.edit");
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const [h] = await db.select().from(publicHolidays).where(eq(publicHolidays.id, id));
  if (!h) return;
  await requireFacilityAccess(h.facilityId, me);
  await db.delete(publicHolidays).where(and(eq(publicHolidays.id, id), eq(publicHolidays.facilityId, h.facilityId)));
  await logActivity("facility", h.facilityId, "holiday_removed", `Public holiday removed: ${formatDate(h.day)} ${h.name}`, me.name);
  revalidatePath(PATH);
}

/** Add the built-in Egyptian list for 2026–2027; dates already on the list are kept as they are. */
export async function addEgyptHolidaysAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("contracts.edit");
  const f = await hospital(Number(fd.get("facilityId")), me);
  if (!f) return fail("Choose a hospital.");
  const added = await db.insert(publicHolidays).values(EGYPT_HOLIDAYS_2026_2027.map((h) => ({ facilityId: f.id, day: h.day, name: h.name, approximate: !!h.approximate })))
    .onConflictDoNothing().returning({ id: publicHolidays.id });
  if (added.length) await logActivity("facility", f.id, "holidays_added", `${added.length} Egyptian public holidays for 2026–2027 added`, me.name);
  revalidatePath(PATH);
  return { message: added.length ? `${added.length} holidays added. Check the religious holidays when their dates are announced.` : "Every date on the list is already there." };
}

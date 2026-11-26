"use server";
/** Wave 37: planning days from announcement to the technical opening per procurement method (wave 39: never below the law). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { fail, type ActionState, zodFail } from "@/lib/procurement/forms";
import { cleanMinDays, LEGAL_MIN_DAYS, METHOD_LABELS, PROCUREMENT_METHODS } from "@/lib/procurement/timetable";
import { logActivity } from "@/lib/server-utils";
import { getSetting, setSetting } from "@/lib/settings";

const day = z.coerce.number({ error: "Enter the days as a whole number from 0 to 365" }).int("Enter whole days").min(0, "Days can't be negative").max(365, "At most 365 days");

export async function saveTenderDaysAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const p = z.object(Object.fromEntries(PROCUREMENT_METHODS.map((m) => [m, day])) as Record<string, typeof day>)
    .safeParse(Object.fromEntries(PROCUREMENT_METHODS.map((m) => [m, fd.get(`min_${m}`) ?? ""])));
  if (!p.success) return zodFail(p.error);
  const low = PROCUREMENT_METHODS.find((m) => p.data[m] < LEGAL_MIN_DAYS[m]);
  if (low) return { errors: [`${METHOD_LABELS[low]}: the legal minimum is ${LEGAL_MIN_DAYS[low]} days. Enter at least that.`], fields: { [`min_${low}`]: `At least ${LEGAL_MIN_DAYS[low]} days.` } };
  const before = cleanMinDays(await getSetting("tenderMinDays"));
  const next = cleanMinDays(p.data);
  const changed = PROCUREMENT_METHODS.filter((m) => before[m] !== next[m]);
  if (!changed.length) return { message: "Nothing changed." };
  if (next.PUBLIC_TENDER < next.LIMITED_PRACTICE) return fail("A public tender normally allows at least as long as a limited practice. Check the days.");
  await setSetting("tenderMinDays", next);
  await logActivity("settings", 0, "updated", `Tender minimum days changed: ${changed.map((m) => `${METHOD_LABELS[m]} ${before[m]} → ${next[m]}`).join("; ")}`, me.name);
  revalidatePath("/admin/settings");
  revalidatePath("/procurement", "layout");
  return { message: `Saved ${changed.length} change${changed.length === 1 ? "" : "s"}.` };
}

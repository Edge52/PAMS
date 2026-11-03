"use server";
/** Capital budget per hospital and year (wave 9, D4). */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { capitalBudgets } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { logActivity } from "@/lib/server-utils";

export async function saveBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const facilityId = Number(fd.get("facilityId")); const year = Number(fd.get("year")); const raw = String(fd.get("amount") ?? "").trim().replace(/,/g, "");
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose a hospital." };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Choose a year." };
  await requireFacilityAccess(facilityId, me);
  if (!raw) {
    await db.delete(capitalBudgets).where(and(eq(capitalBudgets.facilityId, facilityId), eq(capitalBudgets.year, year)));
    revalidatePath("/assets/capital-plan");
    return { ok: `${year}: budget removed.` };
  }
  const amount = Number(raw);
  if (!(amount >= 0 && amount <= 1e13)) return { error: "Enter the budget in EGP." };
  await db.insert(capitalBudgets).values({ facilityId, year, amount: amount.toFixed(2), currency: "EGP" })
    .onConflictDoUpdate({ target: [capitalBudgets.facilityId, capitalBudgets.year], set: { amount: amount.toFixed(2) } });
  await logActivity("facility", facilityId, "capital budget", `${year}: EGP ${amount.toLocaleString("en")}`, me.name);
  revalidatePath("/assets/capital-plan");
  return { ok: `${year}: budget saved.` };
}

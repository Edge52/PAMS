"use server";
/** Wave 38: a device type's Arabic name, printed on letters and specification sheets (catalogue.edit). */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { deviceTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { changeSummary, diff } from "@/lib/audit-diff";
import { fail, formObject, type ActionState, zodFail } from "@/lib/procurement/forms";
import { cleanLegalName } from "@/lib/procurement/legal-names";
import { logActivity } from "@/lib/server-utils";

export async function saveDeviceTypeLegalNameAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = z.object({ code: z.string().min(1).max(48), nameAr: z.string().max(2000).optional() }).safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const ar = cleanLegalName(p.data.nameAr);
  if (!ar.ok) return { errors: [ar.error], fields: { nameAr: ar.error } };
  const [dt] = await db.select().from(deviceTypes).where(eq(deviceTypes.code, p.data.code.toUpperCase()));
  if (!dt) return fail("That device type no longer exists.");
  const changes = diff(dt, { nameAr: ar.value });
  if (!changes) return { message: "Nothing changed." };
  await db.update(deviceTypes).set({ nameAr: ar.value }).where(eq(deviceTypes.id, dt.id));
  await logActivity("device_type", dt.id, "updated", `${dt.name}: ${changeSummary(changes)}`, me.name, db, changes);
  revalidatePath(`/catalogue/${dt.code}`);
  return { message: ar.value ? "Arabic name saved." : "Arabic name removed." };
}

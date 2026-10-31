"use server";
/** Catalogue actions (wave 3): PPM checklists per device type, group or category. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { deviceTypes } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { parseChecklist } from "@/lib/assets/checklists";
import { firstError, formObject, text, type FormState } from "@/lib/assets/forms";
import { logActivity } from "@/lib/server-utils";

const Schema = z.object({ code: z.string().min(1).max(48), checklist: text(20000), mode: z.enum(["save", "inherit"]) });

export async function saveChecklistAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const [dt] = await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).where(eq(deviceTypes.code, p.data.code.toUpperCase()));
  if (!dt) return { error: "That device type no longer exists." };
  let items = null;
  if (p.data.mode === "save") {
    const parsed = parseChecklist(p.data.checklist ?? "");
    if (parsed.errors.length) return { error: parsed.errors.slice(0, 4).join(" ") };
    if (!parsed.items.length) return { error: "Add at least one check, or choose to use the inherited checklist." };
    items = parsed.items;
  }
  await db.update(deviceTypes).set({ ppmChecklist: items }).where(eq(deviceTypes.id, dt.id));
  // Device types have no facility; the catalogue is shared by every hospital.
  await logActivity("device_type", dt.id, "checklist", items ? `PPM checklist saved (${items.length} checks)` : "PPM checklist reset to the inherited one", me.name);
  revalidatePath(`/catalogue/${dt.code}`);
  redirect(`/catalogue/${dt.code}?notice=${encodeURIComponent(items ? "Checklist saved. New maintenance jobs use it." : "Checklist reset.")}#checklist`);
}

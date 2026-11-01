"use server";
/** Catalogue actions (wave 3): PPM checklists per device type, group or category. */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceModels, deviceTypes, preferredModels } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { parseChecklist } from "@/lib/assets/checklists";
import { firstError, formObject, id as idField, isoDate, num as numField, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { cleanName, nameKey, registerCandidates } from "@/lib/assets/models";
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

/* ── Brand and model catalogue (wave 5) ── */

const ModelSchema = z.object({
  id: idField(), deviceTypeId: reqId("Device type"), manufacturer: reqText("Manufacturer", 120), model: reqText("Model", 120),
  refPriceUsd: numField("Reference price", 0, 1e9), endOfSale: isoDate("End of sale"), endOfSupport: isoDate("End of support"), notes: text(2000),
  back: text(300),
});

/** Add a make and model to a device type, or update one. Names are cleaned; the same model twice is refused. */
export async function saveModelAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const p = ModelSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [dt] = await db.select({ id: deviceTypes.id, code: deviceTypes.code, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  if (!dt || dt.level !== 3) return { error: "Choose a device type (not a category or group)." };
  if (d.endOfSale && d.endOfSupport && d.endOfSupport < d.endOfSale) return { error: "End of support can't be before end of sale." };
  const values = {
    deviceTypeId: dt.id, manufacturer: cleanName(d.manufacturer), model: cleanName(d.model), refPriceUsd: d.refPriceUsd != null ? d.refPriceUsd.toFixed(2) : null,
    endOfSale: d.endOfSale ?? null, endOfSupport: d.endOfSupport ?? null, notes: d.notes ?? null,
  };
  const clash = await db.select({ id: deviceModels.id }).from(deviceModels)
    .where(and(eq(deviceModels.deviceTypeId, dt.id), sql`lower(${deviceModels.manufacturer}) = ${nameKey(values.manufacturer)}`, sql`lower(${deviceModels.model}) = ${nameKey(values.model)}`));
  if (clash.some((c) => c.id !== d.id)) return { error: `${values.manufacturer} ${values.model} is already in the catalogue for this device type.` };
  let modelId = d.id;
  if (d.id) {
    const r = await db.update(deviceModels).set(values).where(eq(deviceModels.id, d.id)).returning({ id: deviceModels.id });
    if (!r.length) return { error: "That model was removed." };
  } else {
    [{ id: modelId }] = await db.insert(deviceModels).values(values).returning({ id: deviceModels.id });
  }
  await logActivity("device_model", modelId!, d.id ? "updated" : "created", `${values.manufacturer} ${values.model} (${dt.code})`, me.name);
  revalidatePath("/catalogue/models"); revalidatePath(`/catalogue/${dt.code}`);
  const back = d.back && d.back.startsWith("/catalogue") ? d.back : `/catalogue/models/${modelId}`;
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(d.id ? "Model saved." : `${values.manufacturer} ${values.model} added.`)}`);
}

/** Retire a model from the pick lists (kept for the units that have it), or bring it back. */
export async function setModelActiveAction(fd: FormData) {
  const me = await requirePermission("catalogue.edit");
  const modelId = Number(fd.get("id"));
  const active = fd.get("active") === "1";
  const [m] = await db.update(deviceModels).set({ active }).where(eq(deviceModels.id, modelId)).returning();
  if (!m) redirect("/catalogue/models");
  await logActivity("device_model", m.id, active ? "restored" : "retired", `${m.manufacturer} ${m.model}`, me.name);
  revalidatePath("/catalogue/models");
  redirect(`/catalogue/models/${m.id}?notice=${encodeURIComponent(active ? "Back in the pick lists." : "Retired: no longer offered when registering equipment.")}`);
}

/** Fill the catalogue from the makes and models already typed into the register (every hospital). */
export async function buildModelsFromRegisterAction() {
  const me = await requirePermission("catalogue.edit");
  const rows = await db.select({ deviceTypeId: assets.deviceTypeId, manufacturer: assets.manufacturer, model: assets.model, units: sql<number>`count(*)::int` })
    .from(assets).where(sql`${assets.manufacturer} is not null and ${assets.model} is not null`).groupBy(assets.deviceTypeId, assets.manufacturer, assets.model);
  const existing = await db.select({ deviceTypeId: deviceModels.deviceTypeId, manufacturer: deviceModels.manufacturer, model: deviceModels.model }).from(deviceModels);
  const add = registerCandidates(rows, existing);
  for (let i = 0; i < add.length; i += 200) {
    await db.insert(deviceModels).values(add.slice(i, i + 200).map(({ deviceTypeId, manufacturer, model }) => ({ deviceTypeId, manufacturer, model }))).onConflictDoNothing();
  }
  await logActivity("device_model", 0, "imported", `${add.length} models added from the register`, me.name);
  revalidatePath("/catalogue/models");
  redirect(`/catalogue/models?notice=${encodeURIComponent(add.length ? `${add.length} makes and models added from the register.` : "Every make and model in the register is already in the catalogue.")}`);
}

/** Standardisation: set (or clear) a hospital's preferred model for a device type. */
export async function setPreferredModelAction(fd: FormData) {
  const me = await requirePermission("catalogue.edit");
  const facilityId = Number(fd.get("facilityId")), deviceTypeId = Number(fd.get("deviceTypeId"));
  const modelId = Number(fd.get("modelId")) || null;
  const back = `/assets/fleet?facilityId=${facilityId}`;
  if (!Number.isInteger(facilityId) || facilityId <= 0 || !Number.isInteger(deviceTypeId) || deviceTypeId <= 0) redirect(back);
  await requireFacilityAccess(facilityId, me);
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500) || null;
  if (modelId) {
    const [m] = await db.select().from(deviceModels).where(and(eq(deviceModels.id, modelId), eq(deviceModels.deviceTypeId, deviceTypeId)));
    if (!m) redirect(`${back}&error=${encodeURIComponent("That model isn't in the catalogue for this device type.")}`);
    await db.insert(preferredModels).values({ facilityId, deviceTypeId, modelId, reason, setBy: me.name })
      .onConflictDoUpdate({ target: [preferredModels.facilityId, preferredModels.deviceTypeId], set: { modelId, reason, setBy: me.name, setAt: new Date() } });
    await logActivity("facility", facilityId, "preferred_model", `Preferred ${m.manufacturer} ${m.model} for device type #${deviceTypeId}${reason ? `: ${reason}` : ""}`, me.name);
  } else {
    await db.delete(preferredModels).where(and(eq(preferredModels.facilityId, facilityId), eq(preferredModels.deviceTypeId, deviceTypeId)));
    await logActivity("facility", facilityId, "preferred_model", `No preferred model for device type #${deviceTypeId} any more`, me.name);
  }
  revalidatePath("/assets/fleet");
  redirect(`${back}&notice=${encodeURIComponent(modelId ? "Preferred model saved." : "Preferred model cleared.")}#type-${deviceTypeId}`);
}

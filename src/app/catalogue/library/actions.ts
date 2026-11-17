"use server";
/** Equipment 3D library (wave 17): a catalogue model's clearance zones, connection points and own 3D file (GLB, wave 28: with licence and credit). */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { deviceModels, equipmentModels } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { FormState } from "@/lib/assets/forms";
import { parseConnections, parseZones } from "@/lib/assets/equipment-library";
import { storeFile } from "@/lib/storage";
import { diff } from "@/lib/audit-diff";
import { checkGlb, creditLine, MAX_GLB_BYTES, parseModelCredit } from "@/lib/assets/glb-file";

async function modelOf(fd: FormData) {
  const id = Number(fd.get("modelId"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const [m] = await db.select({ id: deviceModels.id, name: deviceModels.model, maker: deviceModels.manufacturer }).from(deviceModels).where(eq(deviceModels.id, id));
  return m ?? null;
}

/** Save the model's own zones and connections; "typical" clears them so the library's figures for its type apply. */
export async function saveLibraryAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const m = await modelOf(fd); if (!m) return { error: "That model no longer exists." };
  const typical = fd.get("typical") === "1";
  let zones = null, connections = null;
  if (!typical) {
    const z = parseZones(String(fd.get("zones") ?? "")), c = parseConnections(String(fd.get("connections") ?? ""));
    const err = [...z.errors, ...c.errors][0]; if (err) return { error: err };
    zones = z.zones; connections = c.connections;
  }
  await db.insert(equipmentModels).values({ modelId: m.id, zones, connections, updatedByName: me.name })
    .onConflictDoUpdate({ target: equipmentModels.modelId, set: { zones, connections, updatedByName: me.name, updatedAt: new Date() } });
  await logActivity("device_model", m.id, "updated", `3D library: ${typical ? "typical zones and connections for" : "zones and connections of"} ${m.maker} ${m.name}`, me.name);
  revalidatePath("/catalogue/library");
  redirect(`/catalogue/library?notice=${encodeURIComponent(`${m.maker} ${m.name} saved.`)}#model-${m.id}`);
}

/**
 * Upload the model's own 3D file (wave 17; wave 28: administrators only, with licence, credit and source, and the file
 * checked byte by byte to be a self-contained glTF 2.0 binary). Textures are not kept; colours are.
 */
export async function uploadGlbAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("settings.manage"); // administrators: they answer for the licence
  const m = await modelOf(fd); if (!m) return { error: "That model no longer exists." };
  const credit = parseModelCredit({ licence: fd.get("licence"), credit: fd.get("credit"), source: fd.get("source") });
  if (!credit.ok) return { error: Object.values(credit.errors).join(" ") };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a .glb file." };
  if (!file.name.toLowerCase().endsWith(".glb")) return { error: "Upload a binary glTF file (.glb). Export one from Blender, SketchUp or the maker's BIM object." };
  if (file.size > MAX_GLB_BYTES) return { error: `That file is over ${MAX_GLB_BYTES / 1024 / 1024} MB. Reduce it (fewer polygons, no textures) and try again.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkGlb(bytes);
  if (!check.ok) return { error: check.error };
  const [before] = await db.select({ glbName: equipmentModels.glbName, glbLicence: equipmentModels.glbLicence, glbCredit: equipmentModels.glbCredit, glbSource: equipmentModels.glbSource })
    .from(equipmentModels).where(eq(equipmentModels.modelId, m.id));
  const url = await storeFile(`equipment_model/${m.id}`, file.name, bytes);
  const v = { glbUrl: url, glbName: file.name, glbLicence: credit.value.licence, glbCredit: credit.value.credit, glbSource: credit.value.source, glbBytes: bytes.length };
  await db.insert(equipmentModels).values({ modelId: m.id, ...v, updatedByName: me.name })
    .onConflictDoUpdate({ target: equipmentModels.modelId, set: { ...v, updatedByName: me.name, updatedAt: new Date() } });
  const changes = diff(before ?? {}, { glbName: v.glbName, glbLicence: v.glbLicence, glbCredit: v.glbCredit, glbSource: v.glbSource });
  await logActivity("device_model", m.id, "updated", `3D library: model file ${file.name} for ${m.maker} ${m.name} (${creditLine(credit.value)})`, me.name, undefined, changes);
  revalidatePath("/catalogue/library");
  redirect(`/catalogue/library?notice=${encodeURIComponent(`${file.name} uploaded: the 3D view and renders use it for every ${m.name}.`)}#model-${m.id}`);
}

export async function removeGlbAction(fd: FormData) {
  const me = await requirePermission("settings.manage");
  const m = await modelOf(fd); if (!m) return;
  await db.update(equipmentModels).set({ glbUrl: null, glbName: null, glbLicence: null, glbCredit: null, glbSource: null, glbBytes: null, updatedByName: me.name, updatedAt: new Date() }).where(eq(equipmentModels.modelId, m.id));
  await logActivity("device_model", m.id, "updated", `3D library: model file removed from ${m.maker} ${m.name}`, me.name);
  revalidatePath("/catalogue/library");
  redirect(`/catalogue/library?notice=${encodeURIComponent("Model file removed; the built-in shape is used again.")}#model-${m.id}`);
}

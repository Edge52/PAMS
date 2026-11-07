"use server";
/** Equipment 3D library (wave 17): a catalogue model's clearance zones, connection points and own 3D file (GLB). */
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

const MAX_GLB = 25 * 1024 * 1024;

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

/** Upload the model's own 3D file: a binary glTF (.glb), up to 25 MB. Textures are not kept; colours are. */
export async function uploadGlbAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const m = await modelOf(fd); if (!m) return { error: "That model no longer exists." };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a .glb file." };
  if (!file.name.toLowerCase().endsWith(".glb")) return { error: "Upload a binary glTF file (.glb). Export one from Blender, SketchUp or the maker's BIM object." };
  if (file.size > MAX_GLB) return { error: "That file is over 25 MB. Reduce it (fewer polygons, no textures) and try again." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "glTF") return { error: "That file isn't a binary glTF (.glb)." };
  const url = await storeFile(`equipment_model/${m.id}`, file.name, bytes);
  await db.insert(equipmentModels).values({ modelId: m.id, glbUrl: url, glbName: file.name, updatedByName: me.name })
    .onConflictDoUpdate({ target: equipmentModels.modelId, set: { glbUrl: url, glbName: file.name, updatedByName: me.name, updatedAt: new Date() } });
  await logActivity("device_model", m.id, "updated", `3D library: model file ${file.name} for ${m.maker} ${m.name}`, me.name);
  revalidatePath("/catalogue/library");
  redirect(`/catalogue/library?notice=${encodeURIComponent(`${file.name} uploaded: the 3D view uses it for every ${m.name} close up.`)}#model-${m.id}`);
}

export async function removeGlbAction(fd: FormData) {
  const me = await requirePermission("catalogue.edit");
  const m = await modelOf(fd); if (!m) return;
  await db.update(equipmentModels).set({ glbUrl: null, glbName: null, updatedByName: me.name, updatedAt: new Date() }).where(eq(equipmentModels.modelId, m.id));
  await logActivity("device_model", m.id, "updated", `3D library: model file removed from ${m.maker} ${m.name}`, me.name);
  revalidatePath("/catalogue/library");
  redirect(`/catalogue/library?notice=${encodeURIComponent("Model file removed; the built-in shape is used again.")}#model-${m.id}`);
}

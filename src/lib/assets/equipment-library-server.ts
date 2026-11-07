import "server-only";
/** Equipment 3D library (wave 17): each device's library entry (zones, connections, its model's GLB), for the 3D view. */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceModels, deviceTypes, equipmentModels, siteRequirements } from "@/db/schema";
import { libraryEntry, type TwinLibrary } from "./equipment-library";

/** Catalogue models with their library row and site data, keyed "type|maker|model" in lower case. */
async function modelRows() {
  const rows = await db.select({ id: deviceModels.id, typeCode: deviceTypes.code, manufacturer: deviceModels.manufacturer, model: deviceModels.model, lib: equipmentModels, site: siteRequirements })
    .from(deviceModels).innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
    .leftJoin(equipmentModels, eq(equipmentModels.modelId, deviceModels.id)).leftJoin(siteRequirements, eq(siteRequirements.modelId, deviceModels.id));
  return new Map(rows.map((r) => [`${r.typeCode}|${r.manufacturer.trim().toLowerCase()}|${r.model.trim().toLowerCase()}`, r]));
}

/**
 * Library entries for a set of devices: one per catalogue model they match (its own zones, GLB and site data), else one
 * per type (the typical entry). Returns the entries and each device's key into them.
 */
export async function libraryFor(devices: { id: number; typeCode: string; manufacturer: string | null; model: string | null }[]) {
  const models = await modelRows();
  const library: Record<string, TwinLibrary> = {};
  const keyOf = new Map<number, string>();
  for (const d of devices) {
    const m = d.manufacturer && d.model ? models.get(`${d.typeCode}|${d.manufacturer.trim().toLowerCase()}|${d.model.trim().toLowerCase()}`) : undefined;
    const key = m ? `m${m.id}` : `t:${d.typeCode}`;
    if (!(key in library)) {
      const e = libraryEntry(d.typeCode, m?.lib ?? null, m?.site ?? null);
      const glb = m?.lib?.glbUrl ?? null;
      if (!e && !glb) { library[key] = null as unknown as TwinLibrary; continue; }
      library[key] = { ...(e ?? { label: null, zones: [], connections: [], fringe: null, custom: false }), glb, model: m ? `${m.manufacturer} ${m.model}` : null };
    }
    if (library[key]) keyOf.set(d.id, key);
  }
  for (const k of Object.keys(library)) if (!library[k]) delete library[k];
  return { library, keyOf };
}

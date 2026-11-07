/**
 * The equipment library's first set (wave 17): MRI, CT, X-ray and C-arm models from Siemens Healthineers, GE HealthCare,
 * Philips and Wandong Medical put in the catalogue when missing, with typical site data (marked "Typical values", never
 * mistaken for the maker's figures). Runs on every start; adds only what is missing.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db";
import { deviceModels, deviceTypes, siteRequirements } from "../../db/schema";
import { FIRST_SET } from "./equipment-library";
import { TYPICAL } from "./site-fit";

const SOURCE = "Typical values — replace with the manufacturer's site planning guide";

export async function ensureLibraryModels(d: DB): Promise<{ models: number; site: number }> {
  let models = 0, site = 0;
  for (const e of FIRST_SET) {
    const [t] = await d.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.code, e.type));
    const typ = TYPICAL[e.site];
    if (!t || !typ) continue;
    const r = typ.req;
    let [m] = await d.select({ id: deviceModels.id }).from(deviceModels)
      .where(and(eq(deviceModels.deviceTypeId, t.id), sql`lower(${deviceModels.manufacturer}) = ${e.manufacturer.toLowerCase()}`, sql`lower(${deviceModels.model}) = ${e.model.toLowerCase()}`));
    if (!m) {
      [m] = await d.insert(deviceModels).values({ deviceTypeId: t.id, manufacturer: e.manufacturer, model: e.model, lengthM: r.lengthM, widthM: r.widthM, heightM: r.heightM ?? null,
        notes: "Added with the equipment 3D library (wave 17); sizes are typical until the datasheet is entered." }).onConflictDoNothing().returning({ id: deviceModels.id });
      if (!m) continue;
      models++;
    }
    const added = await d.insert(siteRequirements).values({
      modelId: m.id, lengthM: r.lengthM, widthM: r.widthM, heightM: r.heightM ?? null, clearanceM: r.clearanceM,
      minRoomLengthM: r.minRoomLengthM ?? null, minRoomWidthM: r.minRoomWidthM ?? null, minAreaM2: r.minAreaM2 ?? null, minCeilingM: r.minCeilingM ?? null,
      doorWidthM: r.doorWidthM ?? null, doorHeightM: r.doorHeightM ?? null, weightKg: r.weightKg ?? null, powerKva: r.powerKva ?? null, heatKw: r.heatKw ?? null,
      chilledWater: !!r.chilledWater, quenchPipe: !!r.quenchPipe, rfShield: !!r.rfShield, leadLined: !!r.leadLined,
      fringeAlongM: r.fringeAlongM ?? null, fringeAcrossM: r.fringeAcrossM ?? null, source: SOURCE, verified: false, updatedByName: "Equipment library",
    }).onConflictDoNothing().returning({ id: siteRequirements.modelId });
    site += added.length;
  }
  return { models, site };
}

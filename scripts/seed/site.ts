/**
 * Site planning (demo, wave 9): typical planning values on the first CT, MRI, X-ray, C-arm and angiography model in the
 * catalogue — saved with the "typical values" source so they're never mistaken for a manufacturer's figures — and a
 * demo survey of La Plaza's imaging rooms. Skipped when any site data exists.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { buildings, deviceModels, deviceTypes, facilities, floors, rooms, siteRequirements } from "../../src/db/schema";
import { TYPICAL } from "../../src/lib/assets/site-fit";

const SOURCE = "Typical values — replace with the manufacturer's site planning guide";
const BY_TYPE: Record<string, keyof typeof TYPICAL> = { "IMG-CT-128": "ct", "IMG-MRI-15T": "mri", "IMG-XR-DR": "xray", "IMG-XR-CARM": "carm", "IMG-ANG-SP": "angio" };

export default async function seed(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(siteRequirements);
  if (n > 0) { console.log("  site: site data exists, skipped"); return; }
  let added = 0;
  for (const [code, key] of Object.entries(BY_TYPE)) {
    const [m] = await db.select({ id: deviceModels.id }).from(deviceModels).innerJoin(deviceTypes, eq(deviceTypes.id, deviceModels.deviceTypeId))
      .where(and(eq(deviceTypes.code, code), eq(deviceModels.active, true))).orderBy(deviceModels.id).limit(1);
    if (!m) continue;
    const r = TYPICAL[key].req;
    await db.insert(siteRequirements).values({
      modelId: m.id, lengthM: r.lengthM, widthM: r.widthM, heightM: r.heightM ?? null, clearanceM: r.clearanceM,
      minRoomLengthM: r.minRoomLengthM ?? null, minRoomWidthM: r.minRoomWidthM ?? null, minAreaM2: r.minAreaM2 ?? null, minCeilingM: r.minCeilingM ?? null,
      doorWidthM: r.doorWidthM ?? null, doorHeightM: r.doorHeightM ?? null, weightKg: r.weightKg ?? null, powerKva: r.powerKva ?? null, heatKw: r.heatKw ?? null,
      chilledWater: !!r.chilledWater, quenchPipe: !!r.quenchPipe, rfShield: !!r.rfShield, leadLined: !!r.leadLined,
      fringeAlongM: r.fringeAlongM ?? null, fringeAcrossM: r.fringeAcrossM ?? null, source: SOURCE, verified: false, notes: "Demo.", updatedByName: "Demo",
    }).onConflictDoNothing();
    added++;
  }
  // A demo survey of La Plaza's CT, MRI and X-ray rooms.
  const [lph] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, "LPH"));
  let surveyed = 0;
  if (lph) {
    const fl = (await db.select({ id: floors.id }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, lph.id))).map((f) => f.id);
    const rs = fl.length ? await db.select({ id: rooms.id, name: rooms.name }).from(rooms).where(and(inArray(rooms.floorId, fl), sql`${rooms.name} ~* '(\\mCT\\M|MRI|X-?ray|radiograph)'`)) : [];
    for (const r of rs) {
      const mri = /MRI/i.test(r.name);
      await db.update(rooms).set({ ceilingM: mri ? 3.0 : 2.9, doorWidthM: 1.2, doorHeightM: 2.1, floorLoadKgM2: mri ? 1500 : 500,
        services: mri ? { chilledWater: true, quenchPipe: true, rfShield: true, powerKva: 120 } : { leadLined: true, powerKva: 125 } }).where(eq(rooms.id, r.id));
      surveyed++;
    }
  }
  console.log(`  site: typical site data on ${added} models, ${surveyed} rooms surveyed (demo)`);
}

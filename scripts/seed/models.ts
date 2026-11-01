/**
 * Makes and models (demo, wave 5): the catalogue filled from what the register holds, a few support dates so the
 * "support ending" views have something to show, and La Plaza's preferred patient monitor. Skipped when models exist.
 */
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, deviceModels, deviceTypes, facilities, preferredModels } from "../../src/db/schema";
import { registerCandidates } from "../../src/lib/assets/models";

export default async function seed(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(deviceModels);
  if (n > 0) { console.log("  models: catalogue has models, skipped"); return; }
  const rows = await db.select({ deviceTypeId: assets.deviceTypeId, manufacturer: assets.manufacturer, model: assets.model, units: sql<number>`count(*)::int` })
    .from(assets).where(sql`${assets.manufacturer} is not null and ${assets.model} is not null`).groupBy(assets.deviceTypeId, assets.manufacturer, assets.model);
  const add = registerCandidates(rows, []);
  for (let i = 0; i < add.length; i += 200) {
    await db.insert(deviceModels).values(add.slice(i, i + 200).map(({ deviceTypeId, manufacturer, model }) => ({ deviceTypeId, manufacturer, model }))).onConflictDoNothing();
  }
  // Demo support dates: every fifth model no longer sold, every seventh out of support, every eleventh ending next year.
  const all = await db.select({ id: deviceModels.id }).from(deviceModels).orderBy(deviceModels.id);
  for (const [i, m] of all.entries()) {
    if (i % 7 === 3) await db.update(deviceModels).set({ endOfSale: "2021-12-31", endOfSupport: "2025-12-31", notes: "Demo: out of maker support." }).where(eq(deviceModels.id, m.id));
    else if (i % 11 === 5) await db.update(deviceModels).set({ endOfSale: "2024-06-30", endOfSupport: "2027-06-30" }).where(eq(deviceModels.id, m.id));
    else if (i % 5 === 1) await db.update(deviceModels).set({ endOfSale: "2025-03-31" }).where(eq(deviceModels.id, m.id));
  }
  // La Plaza: the most common high-acuity monitor model is the preferred one.
  const [lph] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, "LPH"));
  const [mon] = await db.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.code, "MON-PAT-HIGH"));
  if (lph && mon) {
    const [top] = await db.select({ manufacturer: assets.manufacturer, model: assets.model, n: sql<number>`count(*)::int` }).from(assets)
      .where(and(eq(assets.facilityId, lph.id), eq(assets.deviceTypeId, mon.id), sql`${assets.model} is not null`))
      .groupBy(assets.manufacturer, assets.model).orderBy(sql`count(*) desc`).limit(1);
    const [m] = top ? await db.select({ id: deviceModels.id }).from(deviceModels)
      .where(and(eq(deviceModels.deviceTypeId, mon.id), sql`lower(${deviceModels.manufacturer}) = lower(${top.manufacturer})`, sql`lower(${deviceModels.model}) = lower(${top.model})`)) : [];
    if (m) await db.insert(preferredModels).values({ facilityId: lph.id, deviceTypeId: mon.id, modelId: m.id, reason: "Demo: most units already on it; one service contract.", setBy: "Demo" }).onConflictDoNothing();
  }
  console.log(`  models: ${add.length} makes and models from the register`);
}

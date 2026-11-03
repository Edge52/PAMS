/**
 * Equipment planning (demo, wave 9): a year of monthly exam counts for La Plaza's scanners, demo planning capacities,
 * performance terms on the demo service contracts, a capital budget and running costs on the demo offers.
 * Skipped when any imaging use is recorded. All figures are made up for the demo.
 */
import { and, eq, isNull, like, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, capitalBudgets, deviceTypes, facilities, imagingUsage, offers, serviceContracts, typeCapacity } from "../../src/db/schema";
import { CAPACITY_HINTS } from "../../src/lib/assets/planning";

export default async function seed(db: DB) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(imagingUsage);
  if (n > 0) { console.log("  planning: imaging use recorded, skipped"); return; }
  const [lph] = await db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, "LPH"));
  if (!lph) return;
  for (const [code, perYear] of Object.entries(CAPACITY_HINTS)) {
    const [t] = await db.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.code, code));
    if (t) await db.insert(typeCapacity).values({ deviceTypeId: t.id, examsPerYear: perYear, note: "Demo planning figure" }).onConflictDoNothing();
  }
  const scanners = await db.select({ id: assets.id, code: deviceTypes.code }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, lph.id), like(deviceTypes.code, "IMG-%"), sql`${deviceTypes.code} not like 'IMG-ACC%'`, sql`${assets.status} not in ('DISPOSED','IN_STOCK')`));
  const now = new Date();
  let rows = 0;
  for (const [i, s] of scanners.entries()) {
    const cap = CAPACITY_HINTS[s.code]; if (!cap) continue;
    const load = 0.7 + ((i * 37) % 55) / 100; // 70–124 % of capacity, fixed per scanner
    for (let k = 12; k >= 1; k--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      const wobble = 1 + (((i + 3) * (k + 7)) % 13 - 6) / 100;
      await db.insert(imagingUsage).values({ assetId: s.id, month: d.toISOString().slice(0, 10), exams: Math.round((cap / 12) * load * wobble),
        scheduledHours: s.code === "IMG-CT-128" ? 600 : 360, notes: "Demo", enteredByName: "Demo" }).onConflictDoNothing();
      rows++;
    }
  }
  // Performance terms on the demo contracts that have none.
  await db.update(serviceContracts).set({ repairHours: 72, uptimePct: 95, penaltyPerLateHour: "500", penaltyPerUptimePoint: "10000", penaltyCapPct: 10 })
    .where(and(isNull(serviceContracts.repairHours), sql`${serviceContracts.responseHours} is not null`));
  const y = now.getUTCFullYear();
  for (const [k, amount] of [[0, 60_000_000], [1, 45_000_000], [2, 45_000_000], [3, 50_000_000], [4, 50_000_000]] as const) {
    await db.insert(capitalBudgets).values({ facilityId: lph.id, year: y + k, amount: amount.toFixed(2), currency: "EGP", notes: "Demo" }).onConflictDoNothing();
  }
  // Running costs on the demo offers (a share of nothing real: just so the TCO table has figures).
  const os = await db.select({ id: offers.id }).from(offers).where(isNull(offers.tcoServiceAnnual));
  for (const [i, o] of os.entries()) {
    await db.update(offers).set({ tcoServiceAnnual: String(20000 + i * 3500), tcoConsumablesAnnual: String(4000 + i * 900), tcoEnergyAnnual: String(3000 + i * 400), tcoUptimePct: 95 + (i % 4) }).where(eq(offers.id, o.id));
  }
  console.log(`  planning: ${rows} months of imaging use, budgets, contract terms and offer running costs (demo)`);
}

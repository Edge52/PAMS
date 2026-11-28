/**
 * Demo data for wave 38 (agent M). Runs after the radiation seed. Idempotent: each part is skipped when its table
 * already has rows (holidays and AE titles are added only where missing).
 *  - Egyptian public holidays 2026–2027 for every hospital (editable data; Islamic dates approximate);
 *  - covered hours (Sun–Thu 08:00–20:00, not on holidays) on the first contracts that cover imaging devices;
 *  - MRI helium logs: 120 days of readings; one magnet falling fast and below 70 %, one not read for 10 days;
 *  - AE titles for the scanners, and daily exam counts from the start of the month before last, with month totals
 *    copied into imaging use;
 *  - X-ray tubes on CT and X-ray devices with counter readings: one with a replacement in its history, one close to
 *    the end of its life, one out of warranty.
 * Tolerates missing devices and contracts (nothing to do).
 */
import { and, asc, eq, like, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { DB } from "../../src/db";
import {
  assetAeTitles, assets, contractCoverage, cryogenReadings, deviceTypes, examCounts, facilities, holidays, imagingUsage, serviceContractAssets, tubeReadings, xrayTubes,
} from "../../src/db/schema";
import { addDays, addMonths, daysBetween, parseISO } from "../../src/lib/assets/dates";
import { EGYPT_HOLIDAYS_2026_2027 } from "./demo-holidays";
import { magnetSettings } from "../../src/lib/assets/cryogen";
import { defaultCounter, isTubeType } from "../../src/lib/assets/tubes";
import { monthTotals } from "../../src/lib/assets/exam-import";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const count = async (db: DB, t: PgTable) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n);

/** Exams a day by kind of scanner (demo figures; Friday is the weekend day, Saturday half). */
const PER_DAY: [RegExp, number][] = [[/^IMG-CT/, 38], [/^IMG-MRI/, 16], [/^IMG-XR-(DR|DRC|CR|ANA|MDR)/, 70], [/^IMG-MAM/, 18], [/^IMG-US/, 30], [/^IMG-ANG/, 6], [/^IMG-XR/, 8]];

export default async function seed(db: DB) {
  const today = new Date().toISOString().slice(0, 10);
  const rnd = rng(38);
  const facs = await db.select({ id: facilities.id }).from(facilities).orderBy(asc(facilities.id));
  if (!facs.length) { console.log("  imaging-logs: no hospital, nothing to do"); return; }

  // 1. Demo public holidays for every hospital (added where missing; edited dates stay). Wave 43: the Setup list.
  let hols = 0;
  try {
    const r = await db.insert(holidays).values(EGYPT_HOLIDAYS_2026_2027.map((h) => ({ facilityId: null, day: h.day, name: `${h.name} (demo)`, moves: !!h.approximate })))
      .onConflictDoNothing().returning({ id: holidays.id });
    hols = r.length;
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } })?.code !== "42P01" && (e as { cause?: { code?: string } })?.cause?.code !== "42P01") throw e;
  }

  // 2. Covered hours on contracts that cover imaging devices.
  let covs = 0;
  if (await count(db, contractCoverage) === 0) {
    const cs = await db.selectDistinct({ id: serviceContractAssets.contractId }).from(serviceContractAssets).innerJoin(assets, eq(assets.id, serviceContractAssets.assetId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(like(deviceTypes.code, "IMG-%")).orderBy(asc(serviceContractAssets.contractId)).limit(2);
    for (const c of cs) { await db.insert(contractCoverage).values({ contractId: c.id, allHours: false, days: [0, 1, 2, 3, 4], fromTime: "08:00", toTime: "20:00", excludeHolidays: true }).onConflictDoNothing(); covs++; }
  }

  const scanners = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, code: deviceTypes.code, installDate: assets.installDate })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(like(deviceTypes.code, "IMG-%"), sql`${deviceTypes.code} not like 'IMG-ACC%'`, ne(assets.status, "DISPOSED"), ne(assets.status, "IN_STOCK")))
    .orderBy(asc(assets.id)).limit(400);

  // 3. MRI helium logs.
  let cryo = 0;
  if (await count(db, cryogenReadings) === 0) {
    const mris = scanners.filter((s) => s.code.startsWith("IMG-MRI") && magnetSettings(null, s.code).cryogenic);
    for (const [i, m] of mris.entries()) {
      const fast = i === 0, quiet = i === 1;
      let level = fast ? 79 : 88 - rnd() * 10;
      const rows: (typeof cryogenReadings.$inferInsert)[] = [];
      for (let d = 120; d >= (quiet ? 10 : 1); d -= 7) {
        const on = addDays(today, -d);
        level -= fast ? (d < 40 ? 1.2 : 0.25) : 0.02 + rnd() * 0.05;
        if (!fast && d === 64 && level < 80) level = 95; // a refill
        const coldHead = fast && d < 12 ? "STOPPED" : "RUNNING";
        rows.push({ assetId: m.id, facilityId: m.facilityId, readOn: on, heliumPct: Math.round(level * 10) / 10, pressurePsi: Math.round((1.1 + rnd() * 0.4) * 100) / 100,
          coldHead, compressor: coldHead === "STOPPED" ? "FAULT" : "RUNNING", chillerTempC: Math.round((fast && d < 12 ? 27 : 16 + rnd() * 3) * 10) / 10,
          remarks: fast && d < 12 ? "Compressor tripped; chiller water warm. Service called." : !fast && d === 64 ? "Helium refill by the supplier." : null, readBy: "Biomedical engineer (demo)" });
      }
      await db.insert(cryogenReadings).values(rows);
      cryo += rows.length;
    }
  }

  // 4. AE titles and daily exam counts.
  let aes = 0, days = 0;
  const haveAe = new Set((await db.select({ assetId: assetAeTitles.assetId }).from(assetAeTitles)).map((a) => a.assetId));
  const counted = scanners.filter((s) => PER_DAY.some(([re]) => re.test(s.code))).slice(0, 40);
  for (const s of counted) {
    if (haveAe.has(s.id)) continue;
    const ae = `${s.code.split("-")[1]}_${s.tag.split("-").at(-1)}`.toUpperCase().slice(0, 16);
    const r = await db.insert(assetAeTitles).values({ aeTitle: ae, assetId: s.id }).onConflictDoNothing().returning({ ae: assetAeTitles.aeTitle });
    aes += r.length;
  }
  if (await count(db, examCounts) === 0 && counted.length) {
    const start = addMonths(`${today.slice(0, 7)}-01`, -2);
    for (const s of counted) {
      const base = PER_DAY.find(([re]) => re.test(s.code))![1];
      const rows: (typeof examCounts.$inferInsert)[] = [];
      for (let d = start; d < today; d = addDays(d, 1)) {
        if (s.installDate && d < s.installDate) continue;
        const wd = parseISO(d).getUTCDay();
        const n = Math.max(0, Math.round(base * (wd === 5 ? 0.25 : wd === 6 ? 0.6 : 1) * (0.75 + rnd() * 0.5)));
        rows.push({ assetId: s.id, day: d, procedure: "", modality: s.code.split("-")[1].slice(0, 16), exams: n, source: "Demo RIS export", importedByName: "Demo data" });
      }
      for (let k = 0; k < rows.length; k += 500) await db.insert(examCounts).values(rows.slice(k, k + 500));
      days += rows.length;
      for (const [month, exams] of monthTotals(rows.map((r) => ({ day: r.day, exams: r.exams })))) {
        const v = { exams, notes: "From imported daily counts", enteredByName: "Demo data", updatedAt: new Date() };
        await db.insert(imagingUsage).values({ assetId: s.id, month, ...v }).onConflictDoUpdate({ target: [imagingUsage.assetId, imagingUsage.month], set: v });
      }
    }
  }

  // 5. X-ray tubes.
  let tubes = 0;
  if (await count(db, xrayTubes) === 0) {
    const withTube = scanners.filter((s) => isTubeType(s.code)).slice(0, 8);
    for (const [i, s] of withTube.entries()) {
      const unit = defaultCounter(s.code), ct = unit === "scan_seconds";
      const perDay = ct ? 450 + rnd() * 200 : 60 + rnd() * 40;
      const life = ct ? 400_000 : 100_000;
      // The current tube was fitted this many days ago; device 0 near its end of life, device 1 had a replacement, device 2 out of warranty.
      const age = i === 0 ? Math.round((life * 0.97) / perDay) : i === 2 ? 500 : 120 + Math.floor(rnd() * 300);
      const fitted = addDays(today, -age);
      let counterAtInstall = 0;
      if (i === 1) {
        const oldFitted = addDays(fitted, -Math.round((life * 0.8) / perDay));
        const [old] = await db.insert(xrayTubes).values({ assetId: s.id, facilityId: s.facilityId, serialNumber: `TB-${s.id}-A`, maker: "Demo tubes", model: ct ? "CT tube 7 MHU" : "Rotating anode 300 kHU",
          counterUnit: unit, installedOn: oldFitted, counterAtInstall: 0, warrantyMonths: 12, expectedLife: life, cost: ct ? "2400000" : "450000", currency: "EGP",
          removedOn: fitted, removedReason: "Arcing; failed at 80 % of its expected life" }).returning({ id: xrayTubes.id });
        const total = Math.round(daysBetween(oldFitted, fitted) * perDay);
        await db.insert(tubeReadings).values([{ tubeId: old.id, readOn: addDays(oldFitted, 90), counter: Math.round(90 * perDay), readByName: "Demo data" }, { tubeId: old.id, readOn: fitted, counter: total, note: "When the tube was removed", readByName: "Demo data" }]);
        counterAtInstall = total;
        tubes++;
      }
      const [t] = await db.insert(xrayTubes).values({ assetId: s.id, facilityId: s.facilityId, serialNumber: `TB-${s.id}-${i === 1 ? "B" : "A"}`, maker: "Demo tubes",
        model: ct ? "CT tube 7 MHU" : "Rotating anode 300 kHU", counterUnit: unit, installedOn: fitted, counterAtInstall, warrantyMonths: 12, warrantyCounter: ct ? 200_000 : null,
        expectedLife: life, cost: ct ? "2600000" : "480000", currency: "EGP", underWarranty: false }).returning({ id: xrayTubes.id });
      const rs: (typeof tubeReadings.$inferInsert)[] = [];
      for (let d = Math.min(age, 360); d >= 5; d -= 30) rs.push({ tubeId: t.id, readOn: addDays(today, -d), counter: Math.round(counterAtInstall + (age - d) * perDay), readByName: "Demo data" });
      if (rs.length) await db.insert(tubeReadings).values(rs);
      tubes++;
    }
  }
  console.log(`  imaging-logs: ${hols} holidays, ${covs} contracts with covered hours, ${cryo} helium readings, ${aes} AE titles, ${days} device-days of exams, ${tubes} tubes`);
}

/**
 * Demo calibration and radiation safety records (wave 37). Runs after the safety seed. Idempotent: each part is
 * skipped when its table already has rows.
 *  - calibration intervals for a few device types, and a year of calibrations on devices that need them: most in
 *    date, some due soon or overdue, one failed (that device is out of service), some never calibrated;
 *  - per hospital with radiation devices: ENRRA licences per imaging room (one expired, one expiring), physicist QC
 *    tests (one overdue, one failed), lead aprons and collars with checks, and three months of badge readings.
 * Tolerates missing device types and assets (nothing to do).
 */
import { and, asc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import {
  assets, calibrations, departments, deviceTypeCalibration, deviceTypes, dosimetryPeriods, facilities, protectiveChecks, protectiveItems, radiationLicences, radiationQcTests,
  suppliers,
} from "../../src/db/schema";
import { addDays, addMonths } from "../../src/lib/assets/dates";
import { calibrationInterval, nextCalibrationDue } from "../../src/lib/assets/calibration";
import { doseFlag, isRadiationType, nextCheckDue, periodLimit } from "../../src/lib/assets/radiation";

const TYPE_INTERVALS: Record<string, number> = { "LIF-DEF-MAN": 6, "LIF-DEF-AED": 12, "INF-PMP-VOL": 12, "INF-PMP-SYR": 12, "LIF-VEN-ICU": 6, "LAB-BGA-ANL": 6, "IMG-CT-64": 6 };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

export default async function seed(db: DB) {
  const today = new Date().toISOString().slice(0, 10);
  const rnd = rng(37);
  const facs = await db.select({ id: facilities.id, code: facilities.code }).from(facilities).orderBy(asc(facilities.id));
  if (!facs.length) { console.log("  radiation: no hospital, nothing to do"); return; }

  // 1. Calibration intervals per type (insert only).
  const types = await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.code, Object.keys(TYPE_INTERVALS)));
  if (types.length) await db.insert(deviceTypeCalibration).values(types.map((t) => ({ deviceTypeId: t.id, intervalMonths: TYPE_INTERVALS[t.code] }))).onConflictDoNothing();

  // 2. Calibrations.
  const [{ n: haveCal }] = await db.select({ n: sql<number>`count(*)::int` }).from(calibrations);
  let cals = 0, failed = 0;
  if (Number(haveCal) === 0) {
    const [lab] = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.id)).limit(1);
    const intervals = new Map((await db.select().from(deviceTypeCalibration)).map((r) => [r.deviceTypeId, r.intervalMonths]));
    const devices = await db.select({ id: assets.id, facilityId: assets.facilityId, status: assets.status, deviceTypeId: assets.deviceTypeId }).from(assets)
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(deviceTypes.requiresCalibration, true), eq(assets.isTestEquipment, false), inArray(assets.status, ["IN_SERVICE", "INSTALLED"])))
      .orderBy(asc(assets.id)).limit(5000);
    const rows: (typeof calibrations.$inferInsert)[] = [];
    for (const [i, d] of devices.entries()) {
      const r = rnd();
      if (r < 0.12) continue; // never calibrated
      const months = calibrationInterval(null, intervals.get(d.deviceTypeId)).months;
      // Spread over one cycle, a few overdue (calibrated more than one interval ago).
      const ageDays = Math.floor(r < 0.2 ? months * 30 + 10 + rnd() * 60 : rnd() * months * 30);
      const on = addDays(today, -Math.max(1, ageDays));
      const result = i === 3 ? "FAIL" as const : rnd() < 0.15 ? "ADJUSTED" as const : "PASS" as const;
      const byLab = rnd() < 0.4 && lab;
      rows.push({
        assetId: d.id, facilityId: d.facilityId, calibratedOn: on, performedBy: byLab ? lab.name : "Biomedical workshop", vendorId: byLab ? lab.id : null,
        certificateRef: `CAL-${on.slice(0, 4)}-${String(1000 + i)}`, result, intervalMonths: result === "FAIL" ? null : months,
        nextDue: nextCalibrationDue(on, months, result), statusBefore: result === "FAIL" ? d.status : null,
        notes: result === "FAIL" ? "Output out of tolerance and could not be adjusted. Sent for repair." : result === "ADJUSTED" ? "Adjusted to the maker's tolerance." : null,
        recordedByName: "Demo data",
      });
      if (result === "FAIL") { await db.update(assets).set({ status: "OUT_OF_SERVICE" }).where(eq(assets.id, d.id)); failed++; }
    }
    for (let k = 0; k < rows.length; k += 200) await db.insert(calibrations).values(rows.slice(k, k + 200));
    cals = rows.length;
  }

  // 3. Radiation safety, per hospital.
  const [{ n: haveLic }] = await db.select({ n: sql<number>`count(*)::int` }).from(radiationLicences);
  const [{ n: haveItems }] = await db.select({ n: sql<number>`count(*)::int` }).from(protectiveItems);
  let lics = 0, qcs = 0, items = 0, doses = 0;
  if (Number(haveLic) === 0 && Number(haveItems) === 0) {
    for (const f of facs) {
      const devs = (await db.select({ id: assets.id, roomId: assets.roomId, code: deviceTypes.code, tag: assets.assetTag, departmentId: assets.departmentId }).from(assets)
        .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
        .where(and(eq(assets.facilityId, f.id), ne(assets.status, "DISPOSED"), or(like(deviceTypes.code, "IMG-%"), like(deviceTypes.code, "RTH-%"))))
        .orderBy(asc(assets.id))).filter((d) => isRadiationType(d.code));
      if (!devs.length) continue;
      const roomIds = [...new Set(devs.map((d) => d.roomId).filter((x): x is number => x != null))];
      // Licences: one per room; the first room's has expired, the second's runs out within 90 days.
      for (const [i, roomId] of roomIds.entries()) {
        const expiresOn = i === 0 ? addDays(today, -12) : i === 1 ? addDays(today, 45) : addDays(today, 200 + i * 30);
        await db.insert(radiationLicences).values({
          facilityId: f.id, roomId, licenceNumber: `ENRRA/${f.code}/${2024 + (i % 3)}/${String(310 + i)}`, scope: "Diagnostic radiology: use of the X-ray equipment in this room",
          issuedOn: addMonths(expiresOn, -36), expiresOn, notes: "Demo licence",
        });
        lics++;
      }
      // Mobile units (C-arm, mobile X-ray) without a room get their own licence.
      for (const d of devs.filter((x) => !x.roomId).slice(0, 2)) {
        await db.insert(radiationLicences).values({ facilityId: f.id, assetId: d.id, licenceNumber: `ENRRA/${f.code}/M/${d.id}`, scope: "Mobile X-ray unit", issuedOn: addDays(today, -400), expiresOn: addDays(today, 700) });
        lics++;
      }
      // Physicist QC: yearly; one overdue, one failed.
      for (const [i, d] of devs.slice(0, 12).entries()) {
        const on = i === 0 ? addDays(today, -390) : addDays(today, -Math.floor(30 + rnd() * 300));
        const result = i === 1 ? "FAIL" as const : "PASS" as const;
        await db.insert(radiationQcTests).values({
          facilityId: f.id, assetId: d.id, testName: "Annual physicist QC (acceptance criteria)", testedOn: on, physicist: "Dr. M. Physicist (demo)", result,
          nextDue: nextCheckDue(on, 12, result), notes: result === "FAIL" ? "Tube output 18 % below baseline. Service asked for." : null, recordedByName: "Demo data",
        });
        qcs++;
      }
      // Protective equipment in the first imaging rooms.
      const dept = devs.find((d) => d.departmentId)?.departmentId ?? null;
      const kinds = ["APRON", "APRON", "APRON", "APRON", "THYROID", "THYROID", "SHIELD"] as const;
      for (const [i, kind] of kinds.entries()) {
        const [it] = await db.insert(protectiveItems).values({
          facilityId: f.id, departmentId: dept, roomId: roomIds[i % Math.max(1, roomIds.length)] ?? null, kind,
          label: `${kind === "APRON" ? "Apron 0.35 mm" : kind === "THYROID" ? "Thyroid collar" : "Mobile shield"}, No. ${i + 1}`, intervalMonths: 12,
        }).returning({ id: protectiveItems.id });
        items++;
        if (i === 6) continue; // never checked
        const on = i === 0 ? addDays(today, -380) : addDays(today, -Math.floor(20 + rnd() * 320));
        const result = i === 2 ? "FAIL" as const : "PASS" as const;
        await db.insert(protectiveChecks).values({ itemId: it.id, checkedOn: on, method: "Visual and X-ray screened", result, checkedBy: "Radiation protection officer (demo)", nextDue: nextCheckDue(on, 12, result), notes: result === "FAIL" ? "Crack near the left shoulder." : null });
      }
      // Badge readings: four people, the last three months.
      const [dname] = dept ? await db.select({ id: departments.id }).from(departments).where(eq(departments.id, dept)) : [];
      const people = [["Radiographer A (demo)", "Radiographer"], ["Radiographer B (demo)", "Radiographer"], ["Radiologist C (demo)", "Radiologist"], ["Nurse D (demo)", "Cath lab nurse"]];
      for (let m = 1; m <= 3; m++) {
        const start = addMonths(`${today.slice(0, 7)}-01`, -m), end = addDays(addMonths(start, 1), -1);
        const limit = periodLimit(start, end);
        for (const [pi, [name, role]] of people.entries()) {
          const dose = Math.round((pi === 3 && m === 1 ? 0.62 : 0.02 + rnd() * 0.2) * 100) / 100;
          await db.insert(dosimetryPeriods).values({ facilityId: f.id, departmentId: dname?.id ?? null, personName: name, personRole: role, periodStart: start, periodEnd: end, doseMsv: dose, limitMsv: limit, flag: doseFlag(dose, limit), recordedByName: "Demo data" });
          doses++;
        }
      }
    }
  }
  console.log(`  radiation: ${cals} calibrations (${failed} failed), ${lics} ENRRA licences, ${qcs} QC tests, ${items} protective items, ${doses} badge readings`);
}

/**
 * Demo utilities and water (wave 41; La Plaza added in wave 43): in the demo general hospital, utility systems registered as devices (two
 * generators, UPS, transfer switch, medical gas plant and alarms, theatre and isolation air handling, chiller, water
 * tank, bed lift, fire pump, cold-chain fridges), a few months of tests with a slow generator transfer and a fridge
 * excursion (each with its work order), a generator backup setting, and water sampling points for dialysis, the
 * sterilizer feed and the roof tank with results (one at the action level, one over the limit). La Plaza gets a
 * smaller set: generator (one failed load test), transfer switch, gas alarms, two cold-chain fridges (one excursion)
 * and water points for its RO plant, the sterilizer feed and the roof tank. Demo figures.
 * Idempotent per hospital: skipped when it already has utility systems, or the wave 41 tables don't exist yet.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, criticalBackups, departments, deviceTypes, facilities, rooms, utilitySystems, utilityTests, waterPoints, waterSamples, workOrders } from "../../src/db/schema";
import { defaultsFor, judgeTest, kindForTypeCode, TEST_LABELS, type Readings, type TestKind, type UtilityKind } from "../../src/lib/utilities/utilities";
import { defaultEvery, defaultLimits, judgeSample, type PointKind, type Values } from "../../src/lib/utilities/water";

const DAY = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);

type Spec = { key: string; code: string; dept: string; kind?: UtilityKind; serves: string; make: [string, string]; extra?: Partial<typeof utilitySystems.$inferInsert> };
const SYSTEMS: Spec[] = [
  { key: "gen1", code: "UTL-PWR-GEN", dept: "BME", serves: "Whole hospital, essential circuits", make: ["Cummins", "C550 D5"], extra: { ratedKw: 400, minFuelPct: 60 } },
  { key: "gen2", code: "UTL-PWR-GEN", dept: "BME", serves: "Whole hospital, standby set", make: ["Cummins", "C550 D5"], extra: { ratedKw: 400, minFuelPct: 60 } },
  { key: "ats", code: "UTL-PWR-ATS", dept: "BME", serves: "Essential board", make: ["ABB", "TruONE"] },
  { key: "ups", code: "UTL-PWR-UPS", dept: "OR", serves: "Theatres and recovery", make: ["Eaton", "93PM 80 kW"], extra: { requiredMinutes: 15 } },
  { key: "man", code: "GAS-SRC-MAN", dept: "BME", serves: "Oxygen backup bank", make: ["BeaconMedaes", "Manifold 2x5"] },
  { key: "vac", code: "GAS-SRC-VAC", dept: "BME", serves: "Medical vacuum, all floors", make: ["BeaconMedaes", "Lifeline triplex"] },
  { key: "psa", code: "GAS-SRC-PSA", dept: "BME", serves: "Oxygen, all floors", make: ["Novair", "OXY 120"] },
  { key: "alm", code: "GAS-DIS-ALM", dept: "OR", serves: "Theatre corridor", make: ["Amico", "Alert-3 panel"] },
  { key: "zvb", code: "GAS-DIS-ZVB", dept: "ICU", serves: "ICU beds 1–12", make: ["Amico", "Zone valve box 3 gas"] },
  { key: "ahu", code: "UTL-HVA-AHU", dept: "OR", serves: "Theatres 1–2", make: ["Trox", "X-CUBE"], extra: { requiredAch: 20, pressure: "POSITIVE", minPressurePa: 2.5 } },
  { key: "iso", code: "UTL-HVA-AHU", dept: "MED", kind: "HVAC_ISOLATION", serves: "Isolation room, medical ward", make: ["Trox", "X-CUBE compact"], extra: { requiredAch: 12, pressure: "NEGATIVE", minPressurePa: 2.5 } },
  { key: "chl", code: "UTL-HVA-CHL", dept: "BME", serves: "Chilled water, main building", make: ["Carrier", "30XA"] },
  { key: "tank", code: "UTL-WTR-TNK", dept: "BME", serves: "Roof tank, drinking water", make: ["Local", "GRP 50 m³"] },
  { key: "lift", code: "UTL-LFT-BED", dept: "BME", serves: "Bed lift, theatres to ICU", make: ["Schindler", "5500 bed"] },
  { key: "fire", code: "UTL-FIR-PMP", dept: "BME", serves: "Sprinklers and hydrants", make: ["Grundfos", "Fire NFPA set"] },
  { key: "vax", code: "PHA-CLD-VAC", dept: "PHARM", serves: "Vaccines", make: ["Dometic", "VLS 350"] },
  { key: "phf", code: "PHA-CLD-REF", dept: "PHARM", serves: "Pharmacy cold store", make: ["Liebherr", "MKv 3910"] },
  { key: "bbr", code: "BBK-STO-REF", dept: "LAB", serves: "Blood units", make: ["Helmer", "iB111"] },
];

/** La Plaza (wave 43): a smaller set in its own departments. */
const LPH_SYSTEMS: Spec[] = [
  { key: "gen1", code: "UTL-PWR-GEN", dept: "GEN", serves: "Whole hospital, essential circuits", make: ["Caterpillar", "C32 1000 kVA"], extra: { ratedKw: 800, minFuelPct: 60 } },
  { key: "ats", code: "UTL-PWR-ATS", dept: "GEN", serves: "Essential board", make: ["ASCO", "7000 series"] },
  { key: "alm", code: "GAS-DIS-ALM", dept: "SS", serves: "Surgical suite corridor", make: ["BeaconMedaes", "TotalAlert Infinity"] },
  { key: "alm2", code: "GAS-DIS-ALM", dept: "ICU", serves: "Intensive care", make: ["BeaconMedaes", "TotalAlert Infinity"] },
  { key: "tank", code: "UTL-WTR-TNK", dept: "GEN", serves: "Roof tank, drinking water", make: ["Local", "GRP 80 m³"] },
  { key: "vax", code: "PHA-CLD-VAC", dept: "PHA", serves: "Vaccines", make: ["Liebherr", "LKUv 1613"] },
  { key: "phf", code: "PHA-CLD-REF", dept: "PHA", serves: "Insulin and biologics", make: ["Helmer", "HPR120"] },
];

type Hospital = {
  code: string; systems: Spec[]; tests: () => [string, TestKind, number, Readings][]; backupDept: string;
  water: { roDept: string; cssdDept: string };
};

function dghTests(): [string, TestKind, number, Readings][] {
  // Tests: [system, kind, days ago, readings]
  const tests: [string, TestKind, number, Readings][] = [];
  for (const g of ["gen1", "gen2"]) {
    for (let w = 1; w <= 8; w++) tests.push([g, "GEN_NO_LOAD", w * 7 - (g === "gen2" ? 3 : 1), { durationMin: 15, checksOk: true }]);
    for (let w = 1; w <= 8; w++) tests.push([g, "FUEL", w * 7 - 1, { fuelPct: 92 - w * 3 }]);
  }
  tests.push(["gen1", "GEN_LOAD", 88, { loadKw: 160, durationMin: 30, transferSec: 8, checksOk: true }], ["gen1", "GEN_LOAD", 58, { loadKw: 170, durationMin: 35, transferSec: 9, checksOk: true }],
    ["gen1", "GEN_LOAD", 26, { loadKw: 150, durationMin: 30, transferSec: 12.5, checksOk: true }],
    ["gen2", "GEN_LOAD", 60, { loadKw: 140, durationMin: 30, transferSec: 9, checksOk: true }], ["gen2", "GEN_LOAD", 31, { loadKw: 145, durationMin: 32, transferSec: 8.5, checksOk: true }],
    ["ats", "TRANSFER", 26, { transferSec: 7, checksOk: true }], ["ups", "UPS_AUTONOMY", 70, { autonomyMin: 18, checksOk: true }],
    ["man", "GAS_ALARM", 60, { checksOk: true }], ["man", "INSPECTION", 20, { checksOk: true }], ["vac", "GAS_ALARM", 100, { checksOk: true }], ["vac", "INSPECTION", 25, { checksOk: true }],
    ["psa", "GAS_ALARM", 45, { checksOk: true }], ["psa", "INSPECTION", 12, { checksOk: true }], ["alm", "GAS_ALARM", 80, { checksOk: true }], ["zvb", "INSPECTION", 90, { checksOk: true }],
    ["ahu", "HVAC_CHECK", 40, { airChanges: 22, pressurePa: 8 }], ["iso", "HVAC_CHECK", 36, { airChanges: 13, pressurePa: -4 }],
    ["chl", "INSPECTION", 50, { checksOk: true }], ["tank", "TANK_CLEAN", 150, { checksOk: true }], ["lift", "INSPECTION", 18, { checksOk: true }], ["fire", "INSPECTION", 5, { checksOk: true }]);
  for (const f of ["vax", "phf", "bbr"]) for (let day = 1; day <= 14; day++) {
    const exc = f === "vax" && day === 4;
    tests.push([f, "COLD_CHAIN", day, exc ? { tempMin: 3.1, tempMax: 10.4, excursionMin: 40 } : { tempMin: f === "bbr" ? 2.8 : 3.4, tempMax: f === "bbr" ? 5.1 : 6.6, excursionMin: 0 }]);
  }
  return tests;
}

function lphTests(): [string, TestKind, number, Readings][] {
  const tests: [string, TestKind, number, Readings][] = [];
  for (let w = 1; w <= 8; w++) tests.push(["gen1", "GEN_NO_LOAD", w * 7 - 2, { durationMin: 15, checksOk: true }], ["gen1", "FUEL", w * 7 - 2, { fuelPct: 90 - w * 2 }]);
  tests.push(["gen1", "GEN_LOAD", 95, { loadKw: 330, durationMin: 30, transferSec: 8, checksOk: true }], ["gen1", "GEN_LOAD", 64, { loadKw: 310, durationMin: 18, transferSec: 9, checksOk: true }],
    ["gen1", "GEN_LOAD", 34, { loadKw: 340, durationMin: 32, transferSec: 8.5, checksOk: true }], ["gen1", "GEN_LOAD", 4, { loadKw: 325, durationMin: 30, transferSec: 7.5, checksOk: true }],
    ["ats", "TRANSFER", 34, { transferSec: 6.5, checksOk: true }], ["alm", "GAS_ALARM", 70, { checksOk: true }], ["alm", "GAS_ALARM", 10, { checksOk: true }],
    ["alm2", "GAS_ALARM", 75, { checksOk: true }], ["alm2", "GAS_ALARM", 15, { checksOk: true }], ["tank", "TANK_CLEAN", 120, { checksOk: true }]);
  for (const f of ["vax", "phf"]) for (let day = 1; day <= 21; day++) {
    const exc = f === "phf" && day === 9;
    tests.push([f, "COLD_CHAIN", day, exc ? { tempMin: 4.2, tempMax: 11.8, excursionMin: 95 } : { tempMin: 3.2 + (day % 3) * 0.2, tempMax: 6.1 + (day % 4) * 0.3, excursionMin: 0 }]);
  }
  return tests;
}

const HOSPITALS: Hospital[] = [
  { code: "DGH", systems: SYSTEMS, tests: dghTests, backupDept: "BME", water: { roDept: "MED", cssdDept: "CSSD" } },
  { code: "LPH", systems: LPH_SYSTEMS, tests: lphTests, backupDept: "GEN", water: { roDept: "MS1", cssdDept: "SS" } },
];

export default async function seed(db: DB) {
  const ready = await db.execute<{ t: string | null }>(sql`select to_regclass('public.water_samples')::text as t`);
  if (!ready.rows[0]?.t) { console.log("  utilities: wave 41 tables not there yet, skipped"); return; }
  for (const h of HOSPITALS) await seedHospital(db, h);
}

async function seedHospital(db: DB, h: Hospital) {
  const SYSTEMS = h.systems;
  const [fac] = await db.select().from(facilities).where(eq(facilities.code, h.code));
  if (!fac) { console.log(`  utilities: facility ${h.code} missing, skipped`); return; }
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(utilitySystems).where(eq(utilitySystems.facilityId, fac.id));
  if (have.n > 0) { console.log(`  utilities: ${h.code} demo systems already there, skipped`); return; }
  const tests = h.tests();
  const { createAsset } = await import("../../src/lib/asset-factory");
  const { nextNumber } = await import("../../src/lib/server-utils");

  const codes = [...new Set([...SYSTEMS.map((s) => s.code), "THR-HD-RO", "STR-WSH-WTR"])];
  const types = new Map((await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.code, codes))).map((t) => [t.code, t.id]));
  const depts = new Map((await db.select({ id: departments.id, code: departments.code }).from(departments).where(eq(departments.facilityId, fac.id))).map((d) => [d.code, d.id]));
  const roomOf = async (deptId: number | undefined) => deptId ? (await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.departmentId, deptId), ne(rooms.type, "CORRIDOR"))).orderBy(asc(rooms.id)).limit(1))[0]?.id ?? null : null;

  const sys = new Map<string, { id: number; assetId: number; tag: string; s: typeof utilitySystems.$inferSelect }>();
  let n = 0;
  for (const sp of SYSTEMS) {
    const typeId = types.get(sp.code);
    if (!typeId) continue;
    const deptId = depts.get(sp.dept);
    const a = await createAsset({
      deviceTypeId: typeId, facilityId: fac.id, departmentId: deptId ?? null, roomId: await roomOf(deptId), manufacturer: sp.make[0], model: sp.make[1],
      serialNumber: `UT${String(410000 + ++n)}`, status: "IN_SERVICE", condition: "GOOD", installDate: "2022-03-01", purchaseDate: "2022-01-15", notes: "Demo utility system",
    }, "Seed");
    const kind = sp.kind ?? kindForTypeCode(sp.code) ?? "OTHER";
    const d = defaultsFor(kind, sp.code);
    const [s] = await db.insert(utilitySystems).values({
      assetId: a.id, facilityId: fac.id, kind, serves: sp.serves, critical: !["chl", "lift", "phf"].includes(sp.key),
      requiredMinutes: d.requiredMinutes ?? null, minFuelPct: d.minFuelPct ?? null, tempLow: d.tempLow ?? null, tempHigh: d.tempHigh ?? null,
      requiredAch: d.requiredAch ?? null, pressure: d.pressure ?? null, minPressurePa: d.minPressurePa ?? null, ...sp.extra,
    }).returning();
    sys.set(sp.key, { id: s.id, assetId: a.id, tag: a.assetTag, s });
  }


  let jobs = 0, saved = 0;
  for (const [key, kind, days, r] of tests) {
    const s = sys.get(key);
    if (!s) continue;
    const j = judgeTest(s.s, kind, r);
    const testedOn = ago(days);
    const [t] = await db.insert(utilityTests).values({
      systemId: s.id, assetId: s.assetId, facilityId: fac.id, kind, testedOn, ...r, checksOk: r.checksOk ?? null, passed: j.passed, problems: j.problems, byName: "Demo engineer",
      notes: j.passed ? null : "Demo result",
    }).returning({ id: utilityTests.id });
    saved++;
    if (!j.passed) {
      const at = new Date(`${testedOn}T10:00:00Z`);
      const done = days > 3;
      const [w] = await db.insert(workOrders).values({
        number: await nextNumber("WO", workOrders, workOrders.number, db), assetId: s.assetId, facilityId: fac.id, type: "CORRECTIVE", priority: "URGENT",
        status: done ? "CLOSED" : "OPEN", title: `${TEST_LABELS[kind]} failed on ${s.tag}: ${j.problems[0] ?? ""}`.slice(0, 200), description: j.problems.join("\n"),
        reportedByName: "Demo engineer", reportedAt: at, dueAt: new Date(at.getTime() + 4 * 3_600_000),
        completedAt: done ? new Date(at.getTime() + 26 * 3_600_000) : null, closedAt: done ? new Date(at.getTime() + 30 * 3_600_000) : null,
        resolution: done ? (kind === "COLD_CHAIN" ? "Door seal replaced; stock checked with pharmacy, none lost." : j.problems.some((x) => x.includes("minutes")) ? "Run stopped early by a false fuel alarm; sensor replaced and a full 30-minute load run passed." : "Transfer switch timer reset and contacts cleaned; retest passed.") : null,
      }).returning({ id: workOrders.id });
      await db.update(utilityTests).set({ workOrderId: w.id }).where(eq(utilityTests.id, t.id));
      jobs++;
    }
  }

  // Generator backup: one in use, one standby, kept on Critical backups.
  const gen = sys.get("gen2"), bme = depts.get(h.backupDept);
  if (gen && bme && types.get("UTL-PWR-GEN")) {
    await db.insert(criticalBackups).values({ facilityId: fac.id, departmentId: bme, deviceTypeId: types.get("UTL-PWR-GEN")!, inUseCount: 1, backupCount: 1, notes: "Demo: two sets, one standby" }).onConflictDoNothing();
  }

  // Water: dialysis RO plant (with the dialysis machines, if any), sterilizer feed water, roof tank.
  const [hd] = await db.select({ id: assets.id, roomId: assets.roomId, departmentId: assets.departmentId }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, fac.id), eq(deviceTypes.code, "THR-HD-MCH"))).orderBy(asc(assets.id)).limit(1);
  const plant = async (code: string, dept: string, model: [string, string]) => {
    const typeId = types.get(code);
    if (!typeId) return null;
    const deptId = code === "THR-HD-RO" ? hd?.departmentId ?? depts.get(dept) : depts.get(dept);
    return createAsset({ deviceTypeId: typeId, facilityId: fac.id, departmentId: deptId ?? null, roomId: code === "THR-HD-RO" && hd?.roomId ? hd.roomId : await roomOf(deptId),
      manufacturer: model[0], model: model[1], serialNumber: `UT${String(410000 + ++n)}`, status: "IN_SERVICE", condition: "GOOD", installDate: "2022-03-01", notes: "Demo water plant" }, "Seed");
  };
  const ro = await plant("THR-HD-RO", h.water.roDept, ["Fresenius", "AQUAboss"]);
  const cssd = await plant("STR-WSH-WTR", h.water.cssdDept, ["Steris", "RO feed system"]);
  const pts: { key: string; name: string; kind: PointKind; assetId: number | null; extra?: Partial<typeof waterPoints.$inferInsert> }[] = [
    { key: "ro", name: "RO outlet, dialysis", kind: "DIALYSIS_RO", assetId: ro?.id ?? null },
    { key: "loop", name: "Dialysis loop, return", kind: "DIALYSIS_LOOP", assetId: ro?.id ?? null },
    ...(hd ? [{ key: "mch", name: "Dialysis machine 1", kind: "DIALYSIS_MACHINE" as const, assetId: hd.id }] : []),
    { key: "cssd", name: "Sterilizer feed water, CSSD", kind: "CSSD_FEED", assetId: cssd?.id ?? null, extra: { conductivityMax: 15, notes: "Demo limit: use the sterilizer maker's figure." } },
    { key: "tank", name: "Roof tank, drinking water", kind: "DRINKING_TANK", assetId: sys.get("tank")?.assetId ?? null },
  ];
  let samples = 0;
  for (const p of pts) {
    const [row] = await db.insert(waterPoints).values({ facilityId: fac.id, name: p.name, kind: p.kind, assetId: p.assetId, everyDays: defaultEvery(p.kind), ...defaultLimits(p.kind), ...p.extra }).returning();
    const months = p.kind === "DRINKING_TANK" ? [170, 80] : [175, 145, 115, 85, 55, 25];
    for (const [i, days] of months.entries()) {
      let v: Values;
      if (p.kind.startsWith("DIALYSIS_")) v = { tvc: p.key === "loop" && i === 4 ? 64 : p.key === "ro" && i === 3 ? 140 : [4, 8, 12, 6, 10, 7][i], endotoxin: p.key === "ro" && i === 3 ? 0.31 : [0.02, 0.03, 0.05, 0.03, 0.04, 0.03][i], chlorine: 0.02, chemistryOk: true };
      else if (p.kind === "CSSD_FEED") v = { conductivity: [4.2, 5.1, 6.0, 4.8, 5.5, 5.0][i] };
      else v = { coliforms: 0, freeChlorine: 0.4 };
      const j = judgeSample(limitsOfRow(row), v);
      const sampledOn = ago(days);
      const [s] = await db.insert(waterSamples).values({ pointId: row.id, facilityId: fac.id, sampledOn, ...v, chemistryOk: v.chemistryOk ?? null, lab: "Demo lab", level: j.level, problems: j.problems, byName: "Demo engineer" }).returning({ id: waterSamples.id });
      samples++;
      if (j.level === "FAIL" && p.assetId) {
        const at = new Date(`${sampledOn}T12:00:00Z`);
        const [w] = await db.insert(workOrders).values({
          number: await nextNumber("WO", workOrders, workOrders.number, db), assetId: p.assetId, facilityId: fac.id, type: "CORRECTIVE", priority: "URGENT", status: "CLOSED",
          title: `Water sample failed at ${p.name}: ${j.problems[0] ?? ""}`.slice(0, 200), description: `${j.problems.join("\n")}\n\nDisinfect, find the cause and sample again.`,
          reportedByName: "Demo engineer", reportedAt: at, dueAt: new Date(at.getTime() + 4 * 3_600_000), completedAt: new Date(at.getTime() + 3 * DAY), closedAt: new Date(at.getTime() + 4 * DAY),
          resolution: "RO membranes and loop heat-disinfected; repeat sample within limits.",
        }).returning({ id: workOrders.id });
        await db.update(waterSamples).set({ workOrderId: w.id }).where(eq(waterSamples.id, s.id));
        jobs++;
      }
    }
  }
  console.log(`  utilities: ${h.code} ${sys.size} systems, ${saved} tests, ${pts.length} water points, ${samples} samples, ${jobs} work orders`);
}

function limitsOfRow(p: typeof waterPoints.$inferSelect) {
  return { tvcAction: p.tvcAction, tvcLimit: p.tvcLimit, endotoxinAction: p.endotoxinAction, endotoxinLimit: p.endotoxinLimit, chlorineMax: p.chlorineMax, freeChlorineMin: p.freeChlorineMin, conductivityMax: p.conductivityMax, coliformMax: p.coliformMax };
}

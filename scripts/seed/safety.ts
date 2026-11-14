/**
 * Demo safety records (wave 23). Runs after the asset and work order seeds:
 *  - risk scores and a maintenance strategy for life-support and high-criticality device types (the rest are left
 *    unscored, so "Risk and strategy" has something to do);
 *  - one electrical safety analyser per hospital as test equipment (the second hospital's is out of calibration);
 *  - a year of electrical safety tests on critical devices, a few due or overdue and two failed;
 *  - four incidents at different stages.
 * Tolerates missing device types and assets (nothing to do).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import { assets, deviceTypes, facilities, incidents, safetyTests, users } from "../../src/db/schema";
import { judge, nextTestDue } from "../../src/lib/assets/safety-tests";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export default async function seed(db: DB) {
  const now = Date.now(), rnd = rng(23);

  // 1. Risk scores by criticality (Fennigkoh and Smith), for the types that have a planned interval.
  const SCORE = {
    LIFE_SUPPORT: { riskFunction: 10, riskPhysical: 5, riskMaintenance: 4, maintenanceStrategy: "MANUFACTURER" as const, strategyReason: "Life support. The manufacturer's schedule and checks are followed in full." },
    HIGH: { riskFunction: 7, riskPhysical: 4, riskMaintenance: 3, maintenanceStrategy: "MANUFACTURER" as const, strategyReason: "A failure could injure the patient. Maintained to the manufacturer's schedule." },
  };
  let scored = 0;
  for (const [crit, values] of Object.entries(SCORE)) {
    const done = await db.update(deviceTypes).set(values)
      .where(and(eq(deviceTypes.criticality, crit as "LIFE_SUPPORT" | "HIGH"), sql`${deviceTypes.ppmIntervalMonths} is not null`, sql`${deviceTypes.riskFunction} is null`)).returning({ id: deviceTypes.id });
    scored += done.length;
  }

  // 2. One analyser per hospital.
  const [esa] = await db.select({ id: deviceTypes.id }).from(deviceTypes).where(eq(deviceTypes.code, "BME-TST-ESA"));
  const facs = await db.select({ id: facilities.id, code: facilities.code }).from(facilities).orderBy(asc(facilities.id));
  const [tech] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "TECHNICIAN")).limit(1);
  const [reporter] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "DEPARTMENT_HEAD")).limit(1);
  if (!esa || facs.length === 0) { console.log(`  safety: ${scored} device types scored; no analyser type or hospital, nothing else to do`); return; }
  const analysers = new Map<number, { id: number; label: string; due: string }>();
  for (const [n, f] of facs.entries()) {
    const due = iso(now + (facs.length > 1 && n === 0 ? -20 : 200) * DAY); // the first hospital's analyser has run out: tests there are refused
    const serial = `ESA-${5_100_000 + f.id}`;
    const [a] = await db.insert(assets).values({
      facilityId: f.id, deviceTypeId: esa.id, assetTag: `${f.code}-BME-9${String(f.id).padStart(5, "0")}`, manufacturer: "Fluke Biomedical", model: "ESA615",
      serialNumber: serial, status: "IN_SERVICE", isTestEquipment: true, calibrationDue: due, calibrationCertRef: `CAL-${new Date(now).getFullYear()}-${400 + f.id}`,
    }).onConflictDoNothing().returning({ id: assets.id, tag: assets.assetTag });
    if (a) analysers.set(f.id, { id: a.id, label: `Fluke Biomedical ESA615, serial ${serial} (${a.tag})`, due });
  }

  // 3. Safety tests on life-support and monitoring devices.
  const devices = await db.select({ id: assets.id, facilityId: assets.facilityId, interval: deviceTypes.ppmIntervalMonths, code: deviceTypes.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(inArray(deviceTypes.criticality, ["LIFE_SUPPORT", "HIGH"]), sql`${assets.status} in ('IN_SERVICE', 'INSTALLED')`, eq(assets.isTestEquipment, false)))
    .orderBy(asc(assets.id)).limit(400);
  const tests: (typeof safetyTests.$inferInsert)[] = [];
  for (const [n, d] of devices.entries()) {
    if (rnd() < 0.55) continue; // not every device has been tested yet
    const an = analysers.get(d.facilityId);
    if (!an) continue;
    const interval = d.interval ?? 12;
    // Mostly within the interval; about one in six a little past it (overdue or due soon).
    const ago = rnd() < 0.17 ? Math.round(interval * 30.4 + (rnd() - 0.6) * 50) : Math.round(rnd() * interval * 28);
    const testedOn = iso(now - Math.max(1, ago) * DAY);
    const cf = d.code.startsWith("LIF-DEF") || d.code.startsWith("MON-");
    const failing = n % 97 === 5;
    const reading = {
      protectionClass: "I" as const, appliedPart: cf ? "CF" as const : "BF" as const, method: "DIRECT" as const, visualOk: true, functionalOk: true,
      earthResistanceOhm: Math.round((0.08 + rnd() * 0.12) * 100) / 100, insulationMOhm: Math.round(50 + rnd() * 150),
      equipmentLeakageUa: failing ? 640 : Math.round(90 + rnd() * 220), appliedPartLeakageUa: cf ? Math.round(4 + rnd() * 22) : Math.round(40 + rnd() * 400),
    };
    const verdict = judge(reading);
    tests.push({
      assetId: d.id, testedOn, testedById: tech?.id ?? null, testedByName: tech?.name ?? "Biomedical technician", ...reading,
      analyserAssetId: an.id, analyserLabel: an.label, analyserCalibrationDue: iso(now + 200 * DAY),
      result: verdict.result, failures: verdict.failures, nextDue: verdict.result === "PASS" ? nextTestDue(testedOn, interval) : null,
      notes: failing ? "Mains filter suspected. Device labelled and moved to the workshop." : null,
    });
  }
  for (let i = 0; i < tests.length; i += 500) await db.insert(safetyTests).values(tests.slice(i, i + 500));

  // 4. Incidents.
  // A device of the kind each story needs, from the hospital that has the most of them.
  const pick = async (prefix: string) => (await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(sql`${deviceTypes.code} like ${prefix + "%"}`, sql`${assets.status} in ('IN_SERVICE', 'INSTALLED')`, eq(assets.isTestEquipment, false)))
    .orderBy(sql`(select count(*) from assets x where x.facility_id = ${assets.facilityId}) desc`, asc(assets.id)).limit(1))[0];
  const year = new Date(now).getFullYear();
  const cases = [
    { prefix: "INF-", days: 3, title: "Infusion pump kept running after the door was opened", harm: "SERIOUS" as const, patient: true, quarantined: true, status: "INVESTIGATING" as const,
      description: "During a heparin infusion the nurse opened the pump door to reposition the line. The pump did not stop or alarm and about 6 ml ran in freely before the clamp was closed. The patient was reviewed by the ICU registrar and monitored; clotting tests were repeated.",
      immediate: "Pump swapped for another. The pump, its line and the syringe were labelled and kept as found in the biomedical workshop.", reportBy: iso(now + 4 * DAY) },
    { prefix: "LIF-DEF", days: 12, title: "Defibrillator failed its self-test at shift check", harm: "NEAR_MISS" as const, patient: false, quarantined: true, status: "INVESTIGATING" as const,
      description: "The morning check showed 'battery fault' and the unit would not charge above 50 J. No patient was involved. A spare unit was brought from the ward store.",
      immediate: "Unit removed from the crash trolley and replaced.", rootCause: "Battery pack at the end of its life; the replacement date was not on the planned maintenance checklist." },
    { prefix: "MON-", days: 40, title: "Monitor alarm volume found at zero", harm: "NONE" as const, patient: true, quarantined: false, status: "CLOSED" as const,
      description: "A bedside monitor was found with the alarm volume set to zero after a patient transfer. The low saturation alarm was seen on the central station and acted on in time.",
      immediate: "Volume restored and the other monitors in the bay checked.", rootCause: "Use error: volume turned down during a procedure and not restored. The monitor allows zero volume.",
      corrective: "Minimum alarm volume locked in the configuration of all monitors in the unit; added to the transfer checklist." },
    { prefix: "LIF-VEN", days: 75, title: "Ventilator flow sensor reading drifted", harm: "MINOR" as const, patient: true, quarantined: true, status: "CLOSED" as const,
      description: "Tidal volumes read about 15% low against the test lung. The patient needed a short period of manual ventilation while the ventilator was changed.",
      immediate: "Ventilator changed. Sensor kept for the supplier.", rootCause: "Flow sensor past its stated life.", corrective: "Flow sensors of this model replaced across the unit and added to the six-monthly visit.", maker: iso(now - 70 * DAY) },
  ];
  let made = 0;
  // Runs on every demo start: add each sample incident once only.
  const have = new Set((await db.select({ title: incidents.title }).from(incidents)).map((r) => r.title));
  let next = (await db.select({ n: sql<number>`count(*)::int` }).from(incidents))[0].n;
  for (const c of cases) {
    if (have.has(c.title)) continue;
    const a = await pick(c.prefix);
    if (!a) continue;
    made++;
    const closed = c.status === "CLOSED";
    await db.insert(incidents).values({
      number: `INC-${year}-${String(++next).padStart(4, "0")}`, facilityId: a.facilityId, assetId: a.id, occurredAt: new Date(now - c.days * DAY), title: c.title, description: c.description,
      harm: c.harm, patientInvolved: c.patient, deviceQuarantined: c.quarantined, immediateAction: c.immediate, status: c.status, rootCause: c.rootCause ?? null,
      correctiveAction: c.corrective ?? null, manufacturerNotifiedOn: c.maker ?? null, reportBy: c.reportBy ?? null, reportedById: reporter?.id ?? null, reportedByName: reporter?.name ?? "Ward staff",
      closedAt: closed ? new Date(now - (c.days - 9) * DAY) : null, closedByName: closed ? "Biomedical engineering" : null, createdAt: new Date(now - c.days * DAY + 3_600_000),
    }).onConflictDoNothing();
  }
  console.log(`  safety: ${scored} device types scored, ${analysers.size} analysers, ${tests.length} safety tests, ${made} incidents`);
}

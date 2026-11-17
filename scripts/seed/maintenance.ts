/**
 * Demo data for wave 27 (maintenance): usage intervals and meter readings, test equipment on recent PPM visits,
 * loans, and user training. Runs after `safety` (it uses the analysers made there). Idempotent: each part checks
 * what is already there and adds nothing the second time. Tolerates missing device types, assets and users.
 *
 * The usage intervals are demo figures, not the makers' values: set the real ones on each device type.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import {
  assets, departments, deviceTypes, equipmentLoans, facilities, maintenanceEvents, maintenanceTestEquipment, meterReadings, suppliers,
  trainingAttendees, trainingSessions, userDepartments, users,
} from "../../src/db/schema";
import { instrumentLabel } from "../../src/lib/assets/test-equipment";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Demo usage intervals: type code → [every, unit]. */
const USAGE: Record<string, [number, string]> = {
  "LIF-VEN-ICU": [5000, "hours"],
  "IMG-CT-64": [10000, "scans"],
  "IMG-CT-128": [10000, "scans"],
  "THR-HD-MCH": [1000, "cycles"],
};

export default async function seed(db: DB) {
  const now = Date.now();
  const say: string[] = [];

  // 1. Usage intervals (only where none is set, so an edited value is kept).
  for (const [code, [every, unit]] of Object.entries(USAGE)) {
    await db.update(deviceTypes).set({ usageInterval: every, usageUnit: unit }).where(and(eq(deviceTypes.code, code), isNull(deviceTypes.usageInterval)));
  }

  // 2. Meter readings: ventilators run about 20 hours a day, dialysis machines about 2 cycles a day.
  const [{ n: haveReadings }] = await db.select({ n: sql<number>`count(*)::int` }).from(meterReadings);
  if (haveReadings === 0) {
    const [tech] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "TECHNICIAN")).limit(1);
    const metered = await db.select({ id: assets.id, code: deviceTypes.code }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(inArray(deviceTypes.code, ["LIF-VEN-ICU", "THR-HD-MCH"]), sql`${assets.status} in ('IN_SERVICE','INSTALLED')`)).orderBy(asc(assets.id)).limit(12);
    const rows: (typeof meterReadings.$inferInsert)[] = [];
    for (const [i, a] of metered.entries()) {
      const vent = a.code === "LIF-VEN-ICU";
      const perDay = vent ? 16 + (i % 4) * 2 : 1.5 + (i % 3) * 0.5;
      let reading = vent ? 18_000 + i * 2_300 : 2_400 + i * 310;
      // A reading every 30 days for the last 7 months; the third device's meter was replaced 2 months ago.
      for (let k = 7; k >= 0; k--) {
        const readOn = iso(now - (k * 30 + 2) * DAY);
        if (i === 2 && k === 2) { rows.push({ assetId: a.id, readOn, reading: 0, unit: vent ? "hours" : "cycles", kind: "RESET", note: "Hour meter replaced with the main board", enteredById: tech?.id ?? null, enteredByName: tech?.name ?? "Technician" }); reading = 0; continue; }
        rows.push({ assetId: a.id, readOn, reading: Math.round(reading), unit: vent ? "hours" : "cycles", kind: "READING", enteredById: tech?.id ?? null, enteredByName: tech?.name ?? "Technician" });
        reading += perDay * 30;
      }
    }
    if (rows.length) await db.insert(meterReadings).values(rows);
    say.push(`${rows.length} meter readings on ${metered.length} devices`);
  }

  // 3. Test equipment on the latest completed PPM visits in each hospital (the analyser made by the safety seed).
  const [{ n: haveTe }] = await db.select({ n: sql<number>`count(*)::int` }).from(maintenanceTestEquipment);
  if (haveTe === 0) {
    const tools = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, calibrationDue: assets.calibrationDue })
      .from(assets).where(eq(assets.isTestEquipment, true)).orderBy(asc(assets.id));
    let n = 0;
    for (const t of tools) {
      if (!t.calibrationDue) continue;
      const visits = await db.select({ id: maintenanceEvents.id }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
        .where(and(eq(assets.facilityId, t.facilityId), eq(maintenanceEvents.type, "PPM"), eq(maintenanceEvents.status, "COMPLETED"), sql`${maintenanceEvents.completedDate} <= ${t.calibrationDue}`))
        .orderBy(sql`${maintenanceEvents.completedDate} desc`).limit(15);
      if (visits.length) await db.insert(maintenanceTestEquipment).values(visits.map((v) => ({ eventId: v.id, assetId: t.id, label: instrumentLabel(t), calibrationDue: t.calibrationDue }))).onConflictDoNothing();
      n += visits.length;
    }
    say.push(`test equipment on ${n} PPM visits`);
  }

  // 4. Loans: borrowed and checked; borrowed, not in the register and overdue; lent and returned.
  const [{ n: haveLoans }] = await db.select({ n: sql<number>`count(*)::int` }).from(equipmentLoans);
  const [fac] = await db.select({ id: facilities.id }).from(facilities).orderBy(asc(facilities.id)).limit(1);
  if (haveLoans === 0 && fac) {
    const [bio] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "BIOMEDICAL")).limit(1);
    const [tech] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "TECHNICIAN")).limit(1);
    const [sup] = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.id)).limit(1);
    const [icu] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.facilityId, fac.id), eq(departments.code, "ICU"))).limit(1);
    const [ours] = await db.select({ id: assets.id, serial: assets.serialNumber }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, fac.id), eq(deviceTypes.code, "INF-PMP-SYR"), eq(assets.status, "IN_SERVICE"))).orderBy(asc(assets.id)).limit(1);
    const year = new Date(now).getFullYear();
    const who = { createdById: bio?.id ?? null, createdByName: bio?.name ?? "Biomedical engineer" };
    const rows: (typeof equipmentLoans.$inferInsert)[] = [
      { number: `LN-${year}-0001`, facilityId: fac.id, direction: "BORROWED", otherParty: sup?.name ?? "Supplier", supplierId: sup?.id ?? null,
        deviceDescription: "Ventilator, loan unit while ours is repaired", serialNumber: "LOAN-VEN-2207", departmentId: icu?.id ?? null, purpose: "Cover for a ventilator under repair",
        outOn: iso(now - 12 * DAY), dueBackOn: iso(now + 9 * DAY), conditionOut: "Good, with circuit and humidifier",
        checkPpmOk: true, checkSafetyOk: true, checkedOn: iso(now - 12 * DAY), checkedById: tech?.id ?? null, checkedByName: tech?.name ?? "Technician", checkNote: "Supplier PPM label to next March; safety test sticker in date.", ...who },
      { number: `LN-${year}-0002`, facilityId: fac.id, direction: "BORROWED", isRental: true, otherParty: "Cairo Medical Rentals", deviceDescription: "Syringe pumps, 4 units (rental)",
        departmentId: icu?.id ?? null, purpose: "Winter peak", outOn: iso(now - 40 * DAY), dueBackOn: iso(now - 5 * DAY), conditionOut: "New", cost: "6000", currency: "EGP", ...who },
      ...(ours ? [{ number: `LN-${year}-0003`, facilityId: fac.id, direction: "LENT" as const, otherParty: "Nasser Institute Hospital", assetId: ours.id, serialNumber: ours.serial,
        purpose: "Lent during their shortage", outOn: iso(now - 60 * DAY), dueBackOn: iso(now - 30 * DAY), returnedOn: iso(now - 28 * DAY), conditionOut: "Good", conditionIn: "Good, cleaned", ...who }] : []),
    ];
    await db.insert(equipmentLoans).values(rows).onConflictDoNothing();
    say.push(`${rows.length} loans`);
  }

  // 5. Training in the first hospital's ICU on its device types, one older than two years.
  const [{ n: haveTraining }] = await db.select({ n: sql<number>`count(*)::int` }).from(trainingSessions);
  if (haveTraining === 0 && fac) {
    const [icu] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.facilityId, fac.id), eq(departments.code, "ICU"))).limit(1);
    const types = await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes).where(inArray(deviceTypes.code, ["LIF-VEN-ICU", "MON-PAT-HIGH", "INF-PMP-SYR"]));
    const [head] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, "icu@demo.hpams")).limit(1);
    const [bio] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "BIOMEDICAL")).limit(1);
    if (head && icu) await db.insert(userDepartments).values({ userId: head.id, departmentId: icu.id }).onConflictDoNothing();
    const byCode = new Map(types.map((t) => [t.code, t.id]));
    const plan: { code: string; daysAgo: number; trainer: string; kind: "INITIAL" | "REFRESHER" | "SUPPLIER"; people: string[]; head?: boolean }[] = [
      { code: "LIF-VEN-ICU", daysAgo: 900, trainer: "Supplier application specialist", kind: "SUPPLIER", people: ["Mona Adel", "Karim Samir", "Heba Fawzy"], head: true },
      { code: "LIF-VEN-ICU", daysAgo: 120, trainer: bio?.name ?? "Biomedical engineer", kind: "REFRESHER", people: ["Mona Adel", "Youssef Nabil"] },
      { code: "MON-PAT-HIGH", daysAgo: 300, trainer: bio?.name ?? "Biomedical engineer", kind: "INITIAL", people: ["Mona Adel", "Karim Samir", "Heba Fawzy", "Youssef Nabil"], head: true },
      { code: "INF-PMP-SYR", daysAgo: 60, trainer: "Clinical educator", kind: "INITIAL", people: ["Heba Fawzy", "Sara Mahmoud"] },
    ];
    let made = 0;
    for (const p of plan) {
      const typeId = byCode.get(p.code);
      if (!typeId) continue;
      const [s] = await db.insert(trainingSessions).values({ facilityId: fac.id, deviceTypeId: typeId, heldOn: iso(now - p.daysAgo * DAY), trainer: p.trainer, kind: p.kind,
        departmentId: icu?.id ?? null, notes: "Demo session: set-up, alarms, cleaning, what to do on a fault.", createdByName: "Demo" }).returning({ id: trainingSessions.id });
      await db.insert(trainingAttendees).values([
        ...p.people.map((name) => ({ sessionId: s.id, name, departmentId: icu?.id ?? null })),
        ...(p.head && head ? [{ sessionId: s.id, userId: head.id, name: head.name, departmentId: icu?.id ?? null }] : []),
      ]);
      made++;
    }
    say.push(`${made} training sessions`);
  }

  console.log(`  maintenance: ${say.length ? say.join(", ") : "already there"}`);
}

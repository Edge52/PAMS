/**
 * Demo of waves 39–42 (wave 43), both demo hospitals where it fits. Runs last (after history). Demo figures.
 *  - Equipment management plan: this year's approved through the approvals engine, with one yearly evaluation, and a
 *    draft for next year; critical backup settings (one shortfall); equipment ID card details.
 *  - Technician competency (some expiring soon, one expired, one override on a job); imaging QC templates in use
 *    with records from the start of last month (a few fails, one work order) and a signed review of last month.
 *  - Safety contact officers; the device kept as found after the La Plaza pump incident; an openFDA import with
 *    candidates; a department acknowledgement of a recall.
 *  - Notification choices and digests, an approval deputy, an escalated approval and an escalated fault report,
 *    the on-call technician, saved filters (one shared).
 *  - Cybersecurity of the demo MRI (SBOM, software components, network risks, remote access agreement); GS1 UDI on a
 *    few monitors; an API token (only its name and prefix show; the secret is never printed or kept);
 *    a capital what-if scenario per hospital.
 * Idempotent: each part is skipped when it is already there.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, like, ne, sql } from "drizzle-orm";
import type { DB } from "../../src/db";
import {
  apiTokens, approvalDelegations, approvalRequests, approvalSteps, approvalStepTracking, assetQuarantines, assets, biomedOnCall, capitalScenarios, competencies,
  competencyOverrides, criticalBackups, departments, deviceModels, deviceTypes, documents, equipmentIdCards, equipmentPlanReviews, equipmentPlans, facilities,
  facilitySafetyContacts, imagingQcRecords, imagingQcReviews, imagingQcTemplates, incidents, incidentVigilance, modelSoftwareComponents, networkRisks,
  notificationDigests, notificationPrefs, purchaseOrders, recallAcknowledgements, recallAssets, recallImportRows, recallImports, savedFilters, users,
  workOrderEscalations, workOrders,
} from "../../src/db/schema";
import type { Role } from "../../src/lib/auth/permissions";

const DAY = 86_400_000;
const H = 3_600_000;
const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const ago = (n: number) => addDays(TODAY, -n);
const has = async (q: Promise<unknown[]>) => (await q).length > 0;

type Person = { id: number; name: string; role: Role; allFacilities: boolean; email: string };
type Fac = typeof facilities.$inferSelect;

export default async function seed(db: DB) {
  const ready = await db.execute<{ t: string | null }>(sql`select to_regclass('public.api_tokens')::text as t`);
  if (!ready.rows[0]?.t) { console.log("  showcase: wave 40–41 tables not there yet, skipped"); return; }
  const facs = await db.select().from(facilities).where(inArray(facilities.code, ["DGH", "LPH"])).orderBy(asc(facilities.id));
  const people = new Map((await db.select({ id: users.id, name: users.name, role: users.role, allFacilities: users.allFacilities, email: users.email }).from(users))
    .map((u) => [u.email.split("@")[0], { ...u, role: u.role as Role } satisfies Person]));
  const sara = people.get("biomedical"), tech = people.get("technician"), director = people.get("director"), admin = people.get("admin");
  if (!facs.length || !sara || !tech || !director || !admin) { console.log("  showcase: demo hospitals or users missing, skipped"); return; }
  const done: string[] = [];
  for (const fac of facs) {
    if (await plan(db, fac, sara, director)) done.push(`${fac.code} plan`);
    if (await backups(db, fac)) done.push(`${fac.code} backups`);
    if (await qc(db, fac, tech)) done.push(`${fac.code} imaging QC`);
  }
  const dgh = facs.find((f) => f.code === "DGH"), lph = facs.find((f) => f.code === "LPH");
  if (dgh && await idCards(db, dgh, sara)) done.push("ID cards");
  if (dgh && await competency(db, dgh, sara, tech)) done.push("competency");
  if (await vigilance(db, facs, sara)) done.push("vigilance");
  if (await recallImport(db, sara)) done.push("openFDA import");
  if (await people2(db, people)) done.push("notification choices, deputy, saved filters");
  if (dgh && await escalations(db, dgh, people)) done.push("escalations");
  if (dgh && await cyber(db, dgh, sara)) done.push("cybersecurity");
  if (dgh && await udi(db, dgh)) done.push("GS1 UDI");
  if (await apiToken(db, admin)) done.push("API token");
  if (await scenarios(db, facs, people.get("planner") ?? admin)) done.push("capital scenarios");
  if (!lph) done.push("(no La Plaza)");
  console.log(`  showcase: ${done.length ? done.join("; ") : "already there"}`);
}

/* ── Equipment management plan ── */

async function plan(db: DB, fac: Fac, sara: Person, director: Person): Promise<boolean> {
  if (await has(db.select({ id: equipmentPlans.id }).from(equipmentPlans).where(eq(equipmentPlans.facilityId, fac.id)).limit(1))) return false;
  const { PLAN_TEMPLATE, defaultKpis, kpiSnapshot } = await import("../../src/lib/compliance/equipment-plan");
  const { startApproval, decideStep } = await import("../../src/lib/approvals/server");
  const { planKpiValues } = await import("../../src/lib/compliance/gahar-server");
  const year = Number(TODAY.slice(0, 4));
  const base = { facilityId: fac.id, scope: PLAN_TEMPLATE.scope, riskMethod: PLAN_TEMPLATE.riskMethod, maintenanceStrategy: PLAN_TEMPLATE.maintenanceStrategy, createdById: sara.id, createdByName: sara.name };
  const [p] = await db.insert(equipmentPlans).values({ ...base, year, kpis: defaultKpis(), notes: "Reviewed by the equipment committee in January.", status: "SUBMITTED", submittedAt: new Date(Date.now() - 300 * DAY) })
    .returning({ id: equipmentPlans.id });
  const req = await startApproval({ entity: "EQUIPMENT_PLAN", entityId: p.id, title: `Equipment management plan ${year} v1 (${fac.code})`, href: `/assets/equipment-plan/${p.id}`, facilityId: fac.id }, sara);
  if (req.status === "PENDING") {
    const steps = await db.select({ id: approvalSteps.id }).from(approvalSteps).where(and(eq(approvalSteps.requestId, req.requestId), eq(approvalSteps.status, "PENDING")));
    for (const s of steps) await decideStep(s.id, "APPROVED", "Approved for the year. Report the KPIs to the quality committee each quarter.", director);
  }
  const from = ago(365), to = ago(1);
  const snapshot = kpiSnapshot(defaultKpis(), await planKpiValues(fac.id, from, to, TODAY));
  await db.insert(equipmentPlanReviews).values({
    planId: p.id, periodFrom: from, periodTo: to, kpiSnapshot: snapshot, reviewedById: sara.id, reviewedByName: sara.name,
    findings: "PPM mostly on time; calibration and safety tests behind for a few ward devices; repeat failures on one syringe pump; one incident with harm under investigation.",
    actions: "Move overdue safety tests into the next two weeks; replace the repeat-failure pump; refresher training on pumps for ICU nurses; keep the backup monitors in the ICU at the agreed number.",
  });
  // Next year's draft, started from this year's plan with tighter targets.
  const next = defaultKpis().map((k) => (k.key === "ppm_on_time" ? { ...k, target: 92 } : k.key === "uptime" ? { ...k, target: 96 } : k));
  await db.insert(equipmentPlans).values({ ...base, year: year + 1, kpis: next, notes: "Draft for the equipment committee: targets raised after this year's evaluation." });
  return true;
}

/* ── Critical backups: settings from what each department has, one short by a unit ── */

async function backups(db: DB, fac: Fac): Promise<boolean> {
  const want: [dept: string, code: string, backups: number, short?: boolean][] = fac.code === "DGH"
    ? [["ICU", "LIF-VEN-ICU", 2], ["ICU", "MON-PAT-HIGH", 2, true], ["OR", "LIF-ANE-WS", 1], ["CCU", "INF-PMP-SYR", 2], ["ER", "MON-PAT-MID", 2]]
    : [["ICU", "LIF-VEN-ICU", 1], ["NICU", "LIF-NEO-INC", 1], ["ICU", "INF-PMP-VOL", 3], ["ER", "INF-PMP-VOL", 2]];
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(criticalBackups).innerJoin(deviceTypes, eq(deviceTypes.id, criticalBackups.deviceTypeId))
    .where(and(eq(criticalBackups.facilityId, fac.id), sql`${deviceTypes.code} not like 'UTL-%'`));
  if (have.n > 0) return false;
  let n = 0;
  for (const [dept, code, backup, short] of want) {
    const [row] = await db.select({ deptId: departments.id, typeId: deviceTypes.id, working: sql<number>`count(*) filter (where ${assets.status} in ('INSTALLED', 'IN_SERVICE'))::int` })
      .from(assets).innerJoin(departments, eq(departments.id, assets.departmentId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, fac.id), eq(departments.code, dept), eq(deviceTypes.code, code))).groupBy(departments.id, deviceTypes.id);
    if (!row || row.working < 2) continue;
    const b = Math.min(backup, row.working - 1);
    const inUse = short ? row.working - b + 1 : row.working - b;
    await db.insert(criticalBackups).values({ facilityId: fac.id, departmentId: row.deptId, deviceTypeId: row.typeId, inUseCount: inUse, backupCount: b,
      notes: short ? "Demo: one unit short since the last breakdown." : "Demo setting agreed with the department." }).onConflictDoNothing();
    n++;
  }
  return n > 0;
}

/* ── Equipment ID card details ── */

async function idCards(db: DB, fac: Fac, sara: Person): Promise<boolean> {
  if (await has(db.select({ id: equipmentIdCards.assetId }).from(equipmentIdCards).limit(1))) return false;
  const list = await db.select({ id: assets.id, code: deviceTypes.code, dept: departments.code }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(eq(assets.facilityId, fac.id), inArray(deviceTypes.code, ["IMG-MRI-15T", "IMG-CT-128", "LIF-VEN-ICU", "LIF-ANE-WS"]))).orderBy(asc(assets.id));
  const pick = [...list.filter((a) => a.code.startsWith("IMG-")), ...list.filter((a) => a.code === "LIF-VEN-ICU").slice(0, 3), ...list.filter((a) => a.code === "LIF-ANE-WS").slice(0, 1)];
  for (const a of pick) {
    const imaging = a.code.startsWith("IMG-");
    await db.insert(equipmentIdCards).values({
      assetId: a.id, inHouseName: imaging ? sara.name : "Mahmoud Ali (biomedical technician)", inHousePhone: imaging ? "+20 2 2598 4410 ext. 210" : "+20 2 2598 4410 ext. 214",
      vendorPhone: a.code === "LIF-ANE-WS" ? "+20 2 2735 9000" : null, showOnLabel: imaging || a.code === "LIF-VEN-ICU",
    }).onConflictDoNothing();
  }
  return pick.length > 0;
}

/* ── Technician competency ── */

async function competency(db: DB, fac: Fac, sara: Person, tech: Person): Promise<boolean> {
  if (await has(db.select({ id: competencies.id }).from(competencies).limit(1))) return false;
  const types = new Map((await db.select({ id: deviceTypes.id, code: deviceTypes.code }).from(deviceTypes)
    .where(inArray(deviceTypes.code, ["INF-PMP", "LIF-VEN", "LIF-DEF", "MON-PAT", "IMG-CT", "IMG-MRI", "IMG", "LIF-ANE-WS"]))).map((t) => [t.code, t.id]));
  const rows: [Person, string, "MAKER" | "IN_HOUSE" | "ON_THE_JOB", number, number | null, boolean, string, string | null][] = [
    // person, type, kind, trained days ago, expires in days (null = no expiry), authorised, trainer, certificate
    [tech, "INF-PMP", "MAKER", 400, null, true, "B. Braun Egypt service school", "BBR-SVC-2025-118"],
    [tech, "MON-PAT", "IN_HOUSE", 300, 430, true, sara.name, null],
    [tech, "LIF-VEN", "MAKER", 700, 25, true, "Mindray Middle East (Dubai)", "MR-SV-24-0932"],
    [tech, "LIF-DEF", "IN_HOUSE", 760, -20, true, sara.name, null],
    [tech, "IMG-CT", "ON_THE_JOB", 120, null, false, "Siemens Healthineers field engineer", null],
    [sara, "IMG", "IN_HOUSE", 900, null, true, "Head of biomedical engineering (signed off)", null],
    [sara, "IMG-MRI", "MAKER", 690, 40, true, "Siemens Healthineers, Erlangen", "SHS-MR-XA-2024-55"],
    [sara, "LIF-ANE-WS", "MAKER", 500, 230, true, "Dräger Academy", "DRG-ATL-2025-07"],
  ];
  for (const [p, code, kind, trained, exp, authorised, trainer, cert] of rows) {
    const id = types.get(code);
    if (!id) continue;
    const trainedOn = ago(trained);
    await db.insert(competencies).values({ userId: p.id, deviceTypeId: id, kind, trainedOn, expiresOn: exp == null ? null : addDays(TODAY, exp), authorised, trainer, certificateRef: cert,
      notes: authorised ? null : "Assists the maker's engineer; not yet signed off to work alone.", recordedById: sara.id, recordedByName: sara.name });
  }
  // A job given to the technician on a type he has no record for: allowed, with the reason kept.
  const [job] = await db.select({ id: workOrders.id, assetId: workOrders.assetId }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(workOrders.facilityId, fac.id), eq(workOrders.assignedToId, tech.id), inArray(workOrders.status, ["ASSIGNED", "IN_PROGRESS", "ON_HOLD"]), like(deviceTypes.code, "SUR-%")))
    .orderBy(asc(workOrders.id)).limit(1);
  if (job) {
    await db.insert(competencyOverrides).values({ workOrderId: job.id, assetId: job.assetId, facilityId: fac.id, userId: tech.id, userName: tech.name, problem: "none",
      reason: "Only technician on the evening shift; the theatre needs the unit back tomorrow. Engineer on call reachable by phone.", byId: sara.id, byName: sara.name, at: new Date(Date.now() - 2 * DAY) });
  }
  return true;
}

/* ── Imaging QC ── */

const QC_USED: [string, string][] = [
  ["CT", "CT daily water phantom (example)"], ["CT", "CT monthly checks (example)"], ["MRI", "MRI daily phantom (example)"],
  ["XRAY", "X-ray weekly checks (example)"], ["US", "Ultrasound weekly checks (example)"],
];

async function qc(db: DB, fac: Fac, tech: Person): Promise<boolean> {
  if (await has(db.select({ id: imagingQcTemplates.id }).from(imagingQcTemplates).where(eq(imagingQcTemplates.facilityId, fac.id)).limit(1))) return false;
  const { EXAMPLE_TEMPLATES, judgeRun, failureTitle } = await import("../../src/lib/assets/imaging-qc");
  const { qcScanners, qcMonth } = await import("../../src/lib/assets/imaging-qc-server");
  const { nextNumber } = await import("../../src/lib/server-utils");
  const templates: (typeof imagingQcTemplates.$inferSelect)[] = [];
  for (const [modality, name] of QC_USED) {
    const ex = EXAMPLE_TEMPLATES.find((t) => t.modality === modality && t.name === name);
    if (!ex) continue;
    const [t] = await db.insert(imagingQcTemplates).values({ facilityId: fac.id, modality, name: name.replace(" (example)", ""), frequency: ex.frequency, items: ex.items, isExample: false }).returning();
    templates.push(t);
  }
  const scanners = (await qcScanners(fac.id)).filter((s) => s.status !== "OUT_OF_SERVICE");
  const start = `${addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7)}-01`; // first day of last month
  const value = (it: { min?: number | null; max?: number | null }, k: number) => {
    const w = Math.sin(k * 1.7) * 0.5; // steady wobble inside the limits
    if (it.min != null && it.max != null) return Math.round(((it.min + it.max) / 2 + ((it.max - it.min) / 2) * 0.5 * w) * 10) / 10;
    if (it.max != null) return Math.round(it.max * (0.55 + 0.15 * w) * 10) / 10;
    if (it.min != null) return Math.round((it.min < 0 ? -it.min * 0.2 * w : it.min * (1.35 + 0.1 * w)) * 10) / 10;
    return Math.round((63.87 + 0.002 * w) * 1000) / 1000;
  };
  // Fails: [modality, days ago, item label, failing value or null for FAIL] — the X-ray one opens a work order.
  const FAILS: [string, number, string, number | null][] = [["CT", 12, "Noise, centre (SD)", 7.4], ["MRI", 5, "Ghosting ratio", 3.1], ["XRAY", 9, "Detector flat-field: no lines, blobs or dead areas", null]];
  const usedFail = new Set<string>();
  let n = 0, failed = 0, woMade = false;
  for (const s of scanners) {
    for (const t of templates.filter((x) => x.modality === s.modality)) {
      for (let d = start, k = 0; d < TODAY; d = addDays(d, 1), k++) {
        const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
        const run = t.frequency === "DAILY" ? wd !== 5 : t.frequency === "WEEKLY" ? wd === 0 : d.slice(8) === "03";
        if (!run) continue;
        const fail = FAILS.find(([m, days]) => m === s.modality && ago(days) <= d && addDays(ago(days), 7) > d && !usedFail.has(m));
        const raw = t.items.map((it) => {
          const bad = fail && it.label === fail[2];
          if (it.kind === "PASS_FAIL") return { result: bad ? "FAIL" : "PASS", value: null, note: bad ? "Two thin dark lines across the lower third of the image." : null };
          return { result: null, value: String(bad && fail[3] != null ? fail[3] : value(it, k + s.id)), note: null };
        });
        const j = judgeRun(t.items, raw);
        if (j.problems.length) continue;
        if (fail && !j.passed) usedFail.add(fail[0]);
        const [rec] = await db.insert(imagingQcRecords).values({
          templateId: t.id, assetId: s.id, facilityId: fac.id, departmentId: s.departmentId, performedOn: d, items: t.items, answers: j.answers, passed: j.passed,
          failedCount: j.failed.length, notes: j.passed ? null : "Scanner used for urgent cases only until checked.", performedById: tech.id, performedByName: fac.code === "DGH" ? "Heba Mostafa (radiographer)" : "Amr Fathy (radiographer)",
        }).returning({ id: imagingQcRecords.id });
        n++;
        if (j.passed) continue;
        failed++;
        if (s.modality === "XRAY" && !woMade) {
          const reportedAt = new Date(`${d}T09:30:00Z`);
          const [w] = await db.insert(workOrders).values({
            number: await nextNumber("WO", workOrders, workOrders.number, db), assetId: s.id, facilityId: fac.id, type: "CORRECTIVE", priority: "HIGH", status: "ASSIGNED",
            title: failureTitle(t.name, j.failed), description: `Routine QC on ${d} failed:\n${j.failed.join("\n")}`, deviceDown: false, reportedByName: "Radiographer (routine QC)",
            assignedToId: tech.id, reportedAt, assignedAt: new Date(reportedAt.getTime() + 0.5 * H), dueAt: new Date(reportedAt.getTime() + 8 * H),
          }).returning({ id: workOrders.id });
          await db.update(imagingQcRecords).set({ workOrderId: w.id }).where(eq(imagingQcRecords.id, rec.id));
          woMade = true;
        }
      }
    }
  }
  // Last month's review for the department with the scanners, signed by the radiologist.
  const month = start.slice(0, 7);
  const dept = (await qcMonth(fac.id, month, TODAY)).filter((x) => x.id != null).sort((a, b) => b.runs - a.runs)[0];
  if (dept?.id) {
    await db.insert(imagingQcReviews).values({
      facilityId: fac.id, departmentId: dept.id, month, reviewerRole: "RADIOLOGIST", runs: dept.runs, failed: dept.failed, missed: dept.missed,
      comments: "Runs reviewed. Missed days were Fridays and two days with the scanner booked for lists from 8 am; failures followed up with biomedical engineering.",
      signedByName: fac.code === "DGH" ? "Dr. Mona Adel (consultant radiologist)" : "Dr. Hany Soliman (consultant radiologist)", signedAt: new Date(`${addDays(TODAY, -Number(TODAY.slice(8, 10)) + 3)}T11:00:00Z`),
    }).onConflictDoNothing();
  }
  return n > 0 || failed > 0;
}

/* ── EDA vigilance: safety contacts, device kept as found, recall acknowledgement ── */

async function vigilance(db: DB, facs: Fac[], sara: Person): Promise<boolean> {
  if (await has(db.select({ id: facilitySafetyContacts.facilityId }).from(facilitySafetyContacts).limit(1))) return false;
  for (const f of facs) {
    await db.insert(facilitySafetyContacts).values(f.code === "DGH"
      ? { facilityId: f.id, officerUserId: sara.id, officerName: sara.name, officerJobTitle: "Head of biomedical engineering", officerPhone: "+20 2 2598 4410", officerEmail: sara.email, rpoUserId: sara.id, updatedByName: "Demo data" }
      : { facilityId: f.id, officerName: "Eng. Khaled Samir", officerJobTitle: "Medical device safety officer", officerPhone: "+20 2 2480 1200 ext. 330", officerEmail: "safety.officer@laplaza.example", updatedByName: "Demo data" }).onConflictDoNothing();
  }
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.deviceQuarantined, true), ne(incidents.status, "CLOSED"))).orderBy(asc(incidents.id)).limit(1);
  if (inc?.assetId) {
    const kept = "Biomedical workshop, locked cabinet 2 (with the line and syringe)";
    await db.insert(assetQuarantines).values({ assetId: inc.assetId, facilityId: inc.facilityId, incidentId: inc.id, reason: `Kept as found after ${inc.number}: ${inc.title}`.slice(0, 500), keptAt: kept,
      placedById: sara.id, placedByName: sara.name, placedAt: new Date(inc.occurredAt.getTime() + 2 * H) }).onConflictDoNothing();
    const [a] = await db.select({ serial: assets.serialNumber }).from(assets).where(eq(assets.id, inc.assetId));
    await db.insert(incidentVigilance).values({ incidentId: inc.id, makerReference: "Maker complaint ref. CMP-2026-0412 (demo)", lotNumber: null, udi: a?.serial ? `(01)09506000134352(21)${a.serial}` : null,
      keptAt: kept, reporterJobTitle: "ICU consultant", reporterPhone: "+20 2 2480 1200 ext. 410", reporterEmail: "icu@demo.hpams", updatedByName: sara.name }).onConflictDoNothing();
  }
  const [hit] = await db.select({ recallId: recallAssets.recallId, departmentId: assets.departmentId }).from(recallAssets).innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(sql`${assets.departmentId} is not null`).orderBy(asc(recallAssets.recallId)).limit(1);
  if (hit?.departmentId) await db.insert(recallAcknowledgements).values({ recallId: hit.recallId, departmentId: hit.departmentId, byId: sara.id, byName: sara.name, note: "Read at the morning huddle; nurses told which units are affected." }).onConflictDoNothing();
  return true;
}

/* ── openFDA import with candidates ── */

async function recallImport(db: DB, sara: Person): Promise<boolean> {
  if (await has(db.select({ id: recallImports.id }).from(recallImports).limit(1))) return false;
  const { matchRow } = await import("../../src/lib/assets/openfda");
  const list = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, manufacturer: assets.manufacturer, model: assets.model }).from(assets)
    .where(and(ne(assets.status, "DISPOSED"), sql`${assets.manufacturer} is not null and ${assets.model} is not null`)).limit(50000);
  const rows = [
    { fdaNumber: "Z-0412-2026 (demo)", firm: "Shenzhen Mindray Bio-Medical Electronics Co., Ltd.", product: "BeneVision N15 patient monitor (demo row)", codeInfo: "Software versions before 02.20",
      reason: "Demo row: the alarm tone may not sound after the monitor wakes from standby.", classification: "Class II", initiatedOn: ago(40), fdaStatus: "Ongoing", status: "PENDING" },
    { fdaNumber: "Z-0388-2026 (demo)", firm: "Medela AG", product: "Dominant Flex surgical suction pump (demo row)", codeInfo: "Units made before 2024",
      reason: "Demo row: the overflow valve may stick and let fluid reach the pump.", classification: "Class II", initiatedOn: ago(65), fdaStatus: "Ongoing", status: "PENDING" },
    { fdaNumber: "Z-0301-2026 (demo)", firm: "GE Medical Systems Information Technologies", product: "MAC 2000 resting ECG system (demo row)", codeInfo: "Serial numbers SDQ21…",
      reason: "Demo row: printed reports may show the wrong patient age.", classification: "Class III", initiatedOn: ago(90), fdaStatus: "Terminated", status: "DISMISSED" },
  ];
  const found = rows.map((r) => ({ r, matches: matchRow(r, list) })).filter((x) => x.matches.length);
  const [imp] = await db.insert(recallImports).values({ fileName: "device-recall-0001-of-0001.json (demo)", kind: "recall", rowsRead: 214, candidates: found.length, byId: sara.id, byName: sara.name, createdAt: new Date(Date.now() - 3 * DAY) })
    .returning({ id: recallImports.id });
  for (const { r, matches } of found) {
    const { status, ...row } = r;
    await db.insert(recallImportRows).values({ importId: imp.id, ...row, matches, status,
      decidedByName: status === "DISMISSED" ? sara.name : null, decidedAt: status === "DISMISSED" ? new Date(Date.now() - 2 * DAY) : null });
  }
  return true;
}

/* ── Notification choices, deputy, saved filters ── */

async function people2(db: DB, people: Map<string, Person>): Promise<boolean> {
  if (await has(db.select({ id: notificationPrefs.userId }).from(notificationPrefs).limit(1))) return false;
  const tech = people.get("technician"), fin = people.get("finance"), sara = people.get("biomedical"), director = people.get("director"), admin = people.get("admin");
  const prefs: [Person | undefined, string, string][] = [
    [tech, "work_order_assigned", "BOTH"], [tech, "maintenance_due", "APP"], [tech, "competency_expiry", "EMAIL"], [tech, "executive_pack", "OFF"],
    [fin, "invoice_received", "EMAIL"], [fin, "budget_warning", "BOTH"], [fin, "po_late", "OFF"], [fin, "offer_expiring", "OFF"],
    [sara, "work_order_reported", "APP"], [sara, "maintenance_overdue", "BOTH"],
  ];
  for (const [p, kind, channel] of prefs) if (p) await db.insert(notificationPrefs).values({ userId: p.id, kind, channel }).onConflictDoNothing();
  for (const [p, hour] of [[fin, 8], [sara, 7]] as const) if (p) await db.insert(notificationDigests).values({ userId: p.id, enabled: true, hour }).onConflictDoNothing();
  if (director && admin) {
    await db.insert(approvalDelegations).values({ userId: director.id, deputyId: admin.id, startsOn: addDays(TODAY, 7), endsOn: addDays(TODAY, 16), reason: "Annual leave", setById: director.id, setByName: director.name });
  }
  const filters: [Person | undefined, string, string, string, string, boolean][] = [
    [sara, "assets", "/assets", "ICU devices out of service", "facilityId=1&status=OUT_OF_SERVICE", true],
    [sara, "work-orders", "/assets/work-orders", "Urgent open jobs", "tab=open&priority=URGENT", false],
    [sara, "analytics", "/analytics/maintenance", "La Plaza, last two years", `facilityId=2&from=${ago(730)}&to=${TODAY}`, false],
    [fin, "invoices", "/procurement/invoices", "Waiting for approval", "status=RECEIVED", false],
  ];
  for (const [p, page, pth, name, query, share] of filters) {
    if (!p) continue;
    let q = query;
    if (page === "assets") {
      const [icu] = await db.select({ id: departments.id, f: departments.facilityId }).from(departments).innerJoin(facilities, eq(facilities.id, departments.facilityId))
        .where(and(eq(facilities.code, "DGH"), eq(departments.code, "ICU")));
      if (icu) q = `facilityId=${icu.f}&departmentId=${icu.id}&status=OUT_OF_SERVICE`;
    }
    await db.insert(savedFilters).values({ userId: p.id, page, path: pth, name, query: q, sharedRole: share ? p.role : null }).onConflictDoNothing();
  }
  return true;
}

/* ── Escalated approval and fault report, on call ── */

async function escalations(db: DB, fac: Fac, people: Map<string, Person>): Promise<boolean> {
  if (await has(db.select({ id: workOrderEscalations.workOrderId }).from(workOrderEscalations).where(eq(workOrderEscalations.level, 2)).limit(1))
    || await has(db.select({ id: approvalStepTracking.stepId }).from(approvalStepTracking).where(eq(approvalStepTracking.level, 2)).limit(1))) return false;
  const { runApprovalEscalations } = await import("../../src/lib/approvals/escalation-server");
  const { notifyUsers } = await import("../../src/lib/notifications");
  const { assignerIds } = await import("../../src/lib/assets/work-order-server");
  const { nextNumber } = await import("../../src/lib/server-utils");
  // The PO waiting for the procurement manager has waited two working weeks: the approval job escalates it.
  const [step] = await db.select({ id: approvalSteps.id, requestId: approvalSteps.requestId }).from(approvalSteps).innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.requestId))
    .innerJoin(purchaseOrders, and(eq(approvalRequests.entity, "PO"), eq(purchaseOrders.id, approvalRequests.entityId)))
    .where(and(eq(approvalSteps.status, "PENDING"), eq(approvalRequests.status, "PENDING"))).orderBy(asc(approvalSteps.id)).limit(1);
  let approvals = 0;
  if (step) {
    const since = new Date(Date.now() - 15 * DAY);
    await db.update(approvalRequests).set({ requestedAt: since }).where(eq(approvalRequests.id, step.requestId));
    await db.insert(approvalStepTracking).values({ stepId: step.id, pendingSince: since, level: 0 }).onConflictDoUpdate({ target: approvalStepTracking.stepId, set: { pendingSince: since, level: 0 } });
    approvals = await runApprovalEscalations();
  }
  // A fault report nobody picked up for five hours on a high-criticality monitor.
  const [mon] = await db.select({ id: assets.id, tag: assets.assetTag }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(eq(assets.facilityId, fac.id), eq(departments.code, "CCU"), eq(deviceTypes.code, "MON-PAT-HIGH"), eq(assets.status, "IN_SERVICE"),
      sql`not exists (select 1 from work_orders w where w.asset_id = ${assets.id} and w.status not in ('CLOSED', 'CANCELLED', 'COMPLETED'))`))
    .orderBy(desc(assets.id)).limit(1);
  if (mon) {
    const head = people.get("icu");
    const reportedAt = new Date(Date.now() - 5 * H);
    const [w] = await db.insert(workOrders).values({
      number: await nextNumber("WO", workOrders, workOrders.number, db), assetId: mon.id, facilityId: fac.id, type: "CORRECTIVE", priority: "HIGH", status: "OPEN",
      title: "Screen flickers; alarms still sound", description: "Bed 4. The screen goes dark for a second every few minutes. Patient moved to the spare monitor.",
      deviceDown: false, reportedById: head?.id ?? null, reportedByName: head?.name ?? "CCU charge nurse", reportedAt, dueAt: new Date(reportedAt.getTime() + 8 * H),
    }).returning({ id: workOrders.id, number: workOrders.number });
    const body = `Reported ${reportedAt.toISOString().slice(0, 16).replace("T", " ")} UTC; target to pick up: 2 h.`;
    const href = `/assets/work-orders/${w.id}`;
    const techs = [people.get("technician")?.id, people.get("biomedical")?.id].filter((x): x is number => x != null);
    await notifyUsers(techs, { kind: "fault_unacknowledged", title: `Not picked up yet: ${w.number} on ${mon.tag} — Screen flickers; alarms still sound`, body, href, dedupeKey: `fault_unack:${w.id}` });
    await notifyUsers(await assignerIds(fac.id), { kind: "fault_escalated", title: `Escalated: nobody has picked up ${w.number} on ${mon.tag}`, body, href, dedupeKey: `fault_escalated:${w.id}` });
    await db.insert(workOrderEscalations).values({ workOrderId: w.id, level: 2, lastAt: new Date(Date.now() - H) }).onConflictDoNothing();
  }
  const tech = people.get("technician");
  if (tech && !(await has(db.select({ id: biomedOnCall.id }).from(biomedOnCall).limit(1)))) {
    const start = new Date(`${TODAY}T06:00:00Z`);
    await db.insert(biomedOnCall).values({ facilityId: fac.id, userId: tech.id, startsAt: start, endsAt: new Date(start.getTime() + 7 * DAY), setByName: people.get("biomedical")?.name ?? "Demo data" });
  }
  return approvals > 0 || !!mon;
}

/* ── Cybersecurity of the demo MRI ── */

async function cyber(db: DB, fac: Fac, sara: Person): Promise<boolean> {
  if (await has(db.select({ id: networkRisks.id }).from(networkRisks).limit(1))) return false;
  const [mri] = await db.select({ id: assets.id, typeId: assets.deviceTypeId, maker: assets.manufacturer, model: assets.model }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, fac.id), like(deviceTypes.code, "IMG-MRI%"))).orderBy(asc(assets.id)).limit(1);
  if (!mri) return false;
  const [model] = await db.select({ id: deviceModels.id }).from(deviceModels)
    .where(and(eq(deviceModels.deviceTypeId, mri.typeId), sql`lower(${deviceModels.manufacturer}) = lower(${mri.maker ?? ""})`, sql`lower(${deviceModels.model}) = lower(${mri.model ?? ""})`)).limit(1);
  const root = path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), "storage", "uploads"));
  const file = async (entity: string, id: number, name: string, body: string) => {
    const dir = path.join(root, entity, String(id));
    await mkdir(dir, { recursive: true });
    const stored = `${Date.now()}-${name.replace(/[^\w.\- ]+/g, "_")}`;
    await writeFile(path.join(dir, stored), body);
    return { url: `/files/${entity}/${id}/${encodeURIComponent(stored)}`, size: Buffer.byteLength(body) };
  };
  if (model) {
    const name = `Demo SBOM - ${mri.model}.json`;
    const body = JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", note: "Demo placeholder, not the maker's SBOM", components: [{ name: "Windows 10 IoT Enterprise LTSC", version: "2019" }, { name: "OpenSSL", version: "1.1.1w" }] }, null, 2);
    const f = await file("device_model", model.id, name, body);
    await db.insert(documents).values({ entityType: "device_model", entityId: model.id, kind: "sbom", fileName: name, url: f.url, sizeBytes: f.size, uploadedById: sara.id, note: "From the maker's MDS2 pack (demo)" });
    await db.insert(modelSoftwareComponents).values([
      { deviceModelId: model.id, name: "Windows 10 IoT Enterprise LTSC", version: "2019 (1809)", supplier: "Microsoft", supportEnds: "2029-01-09", notes: "Host computer operating system." },
      { deviceModelId: model.id, name: "OpenSSL", version: "1.1.1w", supplier: "OpenSSL Project", supportEnds: "2023-09-11", notes: "Out of support: ask the maker which update replaces it." },
      { deviceModelId: model.id, name: "Scanner application software", version: "XA51", supplier: mri.maker, supportEnds: null, notes: null },
    ]);
  }
  const agreement = "Demo remote access agreement - MRI.txt";
  const f = await file("asset", mri.id, agreement, "Demo placeholder: the supplier's remote service agreement for the MRI.\n");
  await db.insert(documents).values({ entityType: "asset", entityId: mri.id, kind: "remote_access_agreement", fileName: agreement, url: f.url, sizeBytes: f.size, expiresOn: addDays(TODAY, 45), uploadedById: sara.id });
  await db.insert(networkRisks).values([
    { assetId: mri.id, facilityId: fac.id, connectsTo: "PACS and the worklist (RIS)", dataExchanged: "Images and patient demographics (DICOM)", hazard: "Malware spreading from the hospital network stops the scanner or alters studies",
      likelihood: 3, severity: 4, controls: "Scanner on its own VLAN; only DICOM ports to PACS and RIS open; antivirus approved by the maker.", residualLikelihood: 2, residualSeverity: 3,
      owner: "IT security lead", reviewDue: addDays(TODAY, 120), status: "ACCEPTED", recordedById: sara.id, recordedByName: sara.name },
    { assetId: mri.id, facilityId: fac.id, connectsTo: "Maker's remote service", dataExchanged: "Logs, error files, remote sessions", hazard: "Unauthorised remote access to the scanner",
      likelihood: 3, severity: 4, controls: "Sessions opened by the hospital on request; outbound VPN only; sessions logged.", residualLikelihood: 3, residualSeverity: 3,
      owner: sara.name, reviewDue: ago(10), status: "OPEN", recordedById: sara.id, recordedByName: sara.name },
  ]);
  return true;
}

/* ── GS1 UDI on a few monitors ── */

async function udi(db: DB, fac: Fac): Promise<boolean> {
  if (await has(db.select({ id: assets.id }).from(assets).where(sql`${assets.udiDi} is not null`).limit(1))) return false;
  const { gs1CheckDigit, udiFromInput } = await import("../../src/lib/assets/gs1");
  const list = await db.select({ id: assets.id, serial: assets.serialNumber, install: assets.installDate }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(eq(assets.facilityId, fac.id), eq(deviceTypes.code, "MON-PAT-HIGH"), sql`${assets.serialNumber} is not null`)).orderBy(asc(assets.id)).limit(4);
  // GTIN on GS1's own example company prefix (095060001343…), so it can't be mistaken for a real product.
  const body = "0950600013435";
  const gtin = `${body}${gs1CheckDigit(body)}`;
  for (const a of list) {
    const made = addDays(a.install && a.install < TODAY ? a.install : "2024-03-01", -75).replace(/-/g, "").slice(2); // made a few months before it was installed
    const u = udiFromInput(`(01)${gtin}(11)${made}(21)${a.serial}`);
    if (u.problem || !u.di) continue;
    await db.update(assets).set({ udiDi: u.di, udiPi: u.pi }).where(eq(assets.id, a.id));
  }
  return list.length > 0;
}

/* ── API token: name and prefix only; the secret is thrown away ── */

async function apiToken(db: DB, admin: Person): Promise<boolean> {
  const name = "Power BI refresh (demo)";
  if (await has(db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.name, name)).limit(1))) return false;
  const { newToken } = await import("../../src/lib/api/tokens");
  const t = newToken(); // t.token is never printed or stored: only its hash and prefix are kept, as when an administrator makes one
  await db.insert(apiTokens).values({ name, prefix: t.prefix, tokenHash: t.hash, scopes: ["assets:read", "workorders:read", "analytics:read"], facilityIds: null,
    expiresAt: new Date(Date.now() + 180 * DAY), createdById: admin.id, createdByName: admin.name });
  return true;
}

/* ── Capital what-if scenarios ── */

async function scenarios(db: DB, facs: Fac[], by: Person): Promise<boolean> {
  if (await has(db.select({ id: capitalScenarios.id }).from(capitalScenarios).limit(1))) return false;
  for (const f of facs) {
    await db.insert(capitalScenarios).values({ facilityId: f.id, name: "EGP 40 million a year", settings: { delayYears: 0, budgetPerYear: 40_000_000, includeTypes: [] }, createdById: by.id, createdByName: by.name }).onConflictDoNothing();
  }
  return true;
}

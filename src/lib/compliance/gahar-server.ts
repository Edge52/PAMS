import "server-only";
/**
 * Wave 40: figures for the GAHAR evidence pack and the equipment plan's KPI snapshot. The figures come from the
 * same loaders as the standard reports (PPM compliance, calibration, electrical safety, recalls, user training), so
 * the pack and the reports agree. Rules and the evidence map are pure in ./gahar and ./equipment-plan.
 */
import { and, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  acceptances, assets, dosimetryPeriods, equipmentIdCards, equipmentPlanReviews, equipmentPlans, incidents, protectiveChecks, protectiveItems,
  radiationLicences, radiationQcTests, serviceContractAssets, serviceContracts, supplierContacts, suppliers, workOrders,
} from "@/db/schema";
import { calibrationDevices } from "@/lib/assets/calibration-server";
import { calibrationCompliance } from "@/lib/assets/calibration";
import { radiationDevices } from "@/lib/assets/radiation-server";
import { checkState, latestBy } from "@/lib/assets/radiation";
import { usersWithRole } from "@/lib/notifications";
import { twinLive } from "@/lib/assets/twin-live";
import { equipmentFigures } from "@/lib/reports/executive-calc";
import { ppmComplianceReport } from "@/lib/reports/ppm-compliance";
import { electricalSafetyReport } from "@/lib/reports/electrical-safety";
import { recallsReport } from "@/lib/reports/recalls";
import { trainingFigures } from "@/lib/reports/user-training";
import { facilityCond } from "@/lib/reports/shared";
import { DEFAULT_PPM_GRACE_DAYS } from "@/lib/reports/calc";
import type { ReportContext, ReportFilters, ReportResult } from "@/lib/reports/types";
import { addDaysISO } from "@/lib/format";
import { utilityEvidence } from "@/lib/utilities/utilities-server";
import { UTILITY_TYPE_CODES } from "@/lib/utilities/utilities";
import { backupRows } from "./critical-backup-server";
import { pctOf, type EvidenceKey, type Figure } from "./gahar";
import type { KpiKey } from "./equipment-plan";

const IN_USE = ["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "ON_LOAN"] as const;
const totalOf = (r: ReportResult, section: string, key: string): number | null => {
  const v = r.sections.find((s) => s.key === section)?.totals?.[key];
  return typeof v === "number" ? v : null;
};

function ctxFor(facilityId: number | null, scope: number[] | null, from: string, to: string, today: string): ReportContext {
  const filters: ReportFilters = { facilityId, from, to, days: 90, grace: DEFAULT_PPM_GRACE_DAYS, projectStatus: "open" };
  return { filters, scope, today };
}

/** Facilities the figures cover: the chosen one, else every one in scope (null = all). */
async function facilityIds(facilityId: number | null, scope: number[] | null): Promise<number[] | null> {
  return facilityId ? [facilityId] : scope;
}

/** Devices (in use) with a vendor emergency phone and with a full ID card (vendor phone and in-house contact). */
async function contactFigures(f: ReportFilters, scope: number[] | null, today: string) {
  const vendorPhone = sql<boolean>`(
    coalesce(${equipmentIdCards.vendorPhone}, '') <> ''
    or coalesce(${suppliers.phone}, '') <> ''
    or exists (select 1 from ${supplierContacts} sc where sc.supplier_id = ${assets.supplierId} and sc.role = 'SERVICE' and coalesce(sc.phone, '') <> '')
    or exists (select 1 from ${serviceContractAssets} sca join ${serviceContracts} c on c.id = sca.contract_id
      where sca.asset_id = ${assets.id} and c.start_date <= ${today} and c.end_date >= ${today} and coalesce(c.contact_phone, '') <> ''))`;
  const [r] = await db.select({
    n: sql<number>`count(*)::int`,
    vendor: sql<number>`count(*) filter (where ${vendorPhone})::int`,
    card: sql<number>`count(*) filter (where ${vendorPhone} and coalesce(${equipmentIdCards.inHouseName}, '') <> '')::int`,
    complete: sql<number>`count(*) filter (where coalesce(${assets.serialNumber}, '') <> '' and ${assets.departmentId} is not null and ${assets.roomId} is not null)::int`,
  }).from(assets).leftJoin(suppliers, eq(suppliers.id, assets.supplierId)).leftJoin(equipmentIdCards, eq(equipmentIdCards.assetId, assets.id))
    .where(and(inArray(assets.status, [...IN_USE]), facilityCond(assets.facilityId, f, scope)));
  return { devices: r?.n ?? 0, vendor: r?.vendor ?? 0, card: r?.card ?? 0, complete: r?.complete ?? 0 };
}

/** Every evidence figure for the pack. */
export async function gaharFigures(ctx: ReportContext): Promise<Partial<Record<EvidenceKey, Figure>>> {
  const { filters: f, scope, today } = ctx;
  const from = f.from ?? addDaysISO(today, -365), to = f.to ?? today;
  const c = ctxFor(f.facilityId, scope, from, to, today);
  const ids = await facilityIds(f.facilityId, scope);
  const year = Number(to.slice(0, 4));
  const yearAgo = addDaysISO(today, -365);

  const [ppm, safety, recall, training, cal, contacts, plans, reviews, biomed, installed, jobs, incs, rad, licences, qcRows, items, checks, doses] = await Promise.all([
    ppmComplianceReport(c), electricalSafetyReport(c), recallsReport(c), trainingFigures(c),
    calibrationDevices(scope, today, f.facilityId ? { facilityId: f.facilityId } : {}),
    contactFigures(f, scope, today),
    db.select({ facilityId: equipmentPlans.facilityId }).from(equipmentPlans)
      .where(and(eq(equipmentPlans.year, year), eq(equipmentPlans.status, "APPROVED"), facilityCond(equipmentPlans.facilityId, f, scope))),
    db.select({ facilityId: equipmentPlans.facilityId }).from(equipmentPlanReviews).innerJoin(equipmentPlans, eq(equipmentPlans.id, equipmentPlanReviews.planId))
      .where(and(gte(sql`${equipmentPlanReviews.createdAt}::date`, yearAgo), facilityCond(equipmentPlans.facilityId, f, scope))),
    f.facilityId ? usersWithRole("BIOMEDICAL", f.facilityId) : usersWithRole("BIOMEDICAL", null),
    db.select({ n: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${acceptances.status} = 'ACCEPTED')::int` })
      .from(assets).leftJoin(acceptances, eq(acceptances.assetId, assets.id))
      .where(and(facilityCond(assets.facilityId, f, scope), gte(assets.installDate, from), lte(assets.installDate, to), ne(assets.status, "DISPOSED"))),
    db.select({ n: sql<number>`count(*)::int` }).from(workOrders)
      .where(and(facilityCond(workOrders.facilityId, f, scope), gte(sql`${workOrders.reportedAt}::date`, from), lte(sql`${workOrders.reportedAt}::date`, to))),
    db.select({ n: sql<number>`count(*)::int`, acted: sql<number>`count(*) filter (where ${incidents.status} = 'CLOSED' or coalesce(${incidents.correctiveAction}, '') <> '')::int` })
      .from(incidents).where(and(facilityCond(incidents.facilityId, f, scope), gte(sql`${incidents.occurredAt}::date`, from), lte(sql`${incidents.occurredAt}::date`, to))),
    radiationDevices(f.facilityId),
    db.select({ expiresOn: radiationLicences.expiresOn }).from(radiationLicences).where(and(eq(radiationLicences.active, true), facilityCond(radiationLicences.facilityId, f, scope))),
    db.select({ id: radiationQcTests.id, assetId: radiationQcTests.assetId, testName: radiationQcTests.testName, testedOn: radiationQcTests.testedOn, result: radiationQcTests.result, nextDue: radiationQcTests.nextDue })
      .from(radiationQcTests).where(and(isNotNull(radiationQcTests.assetId), facilityCond(radiationQcTests.facilityId, f, scope))).limit(20000),
    db.select({ id: protectiveItems.id }).from(protectiveItems).where(and(eq(protectiveItems.active, true), facilityCond(protectiveItems.facilityId, f, scope))),
    db.select({ id: protectiveChecks.id, itemId: protectiveChecks.itemId, checkedOn: protectiveChecks.checkedOn, result: protectiveChecks.result, nextDue: protectiveChecks.nextDue })
      .from(protectiveChecks).innerJoin(protectiveItems, eq(protectiveItems.id, protectiveChecks.itemId))
      .where(and(eq(protectiveItems.active, true), facilityCond(protectiveItems.facilityId, f, scope))).limit(20000),
    db.select({ n: sql<number>`count(*)::int` }).from(dosimetryPeriods).where(and(facilityCond(dosimetryPeriods.facilityId, f, scope), gte(dosimetryPeriods.periodEnd, yearAgo))),
  ]);

  const [util, backups] = await Promise.all([
    utilityEvidence(scope, f.facilityId, from, to, today),
    backupRows(scope, f.facilityId ?? undefined).then((rows) => rows.filter((r) => UTILITY_TYPE_CODES.includes(r.typeCode) || r.typeCode.startsWith("UTL-"))),
  ]);
  const facCount = ids === null ? null : ids.length;
  const planFacs = new Set(plans.map((p) => p.facilityId)), reviewFacs = new Set(reviews.map((p) => p.facilityId));
  const allHave = (s: Set<number>) => (facCount === null ? s.size > 0 : facCount > 0 && ids!.every((id) => s.has(id)));
  const calPct = calibrationCompliance(cal.map((d) => d.state)).pct;

  const radDevices = rad.filter((d) => scope === null || scope.includes(d.facilityId));
  const radIds = new Set(radDevices.map((d) => d.id));
  const qcLatest = latestBy(qcRows.filter((q) => q.assetId != null && radIds.has(q.assetId)), (q) => `${q.assetId}|${q.testName.trim().toLowerCase()}`, (q) => q.testedOn);
  const qcBad = new Set<number>(), qcAny = new Set<number>();
  for (const q of qcLatest.values()) {
    qcAny.add(q.assetId!);
    const s = checkState(q, today);
    if (s === "failed" || s === "overdue") qcBad.add(q.assetId!);
  }
  const qcOk = [...radIds].filter((id) => qcAny.has(id) && !qcBad.has(id)).length;
  const calByAsset = new Map(cal.map((d) => [d.id, d.state]));
  const radEquipOk = [...radIds].filter((id) => (qcAny.has(id) && !qcBad.has(id)) || ["ok", "soon"].includes(calByAsset.get(id) ?? "")).length;
  const lastCheck = latestBy(checks, (x) => String(x.itemId), (x) => x.checkedOn);
  const ppeOk = items.filter((i) => { const l = lastCheck.get(String(i.id)); const s = checkState(l ?? null, today); return s === "ok" || s === "soon"; }).length;
  const noRad = radDevices.length === 0;

  return {
    plan_approved: { yes: allHave(planFacs), detail: `Plan year ${year}` },
    plan_reviewed: { yes: allHave(reviewFacs) },
    biomed_in_charge: { count: biomed.length },
    inventory: contacts.devices ? { pct: pctOf(contacts.complete, contacts.devices), detail: `${contacts.complete} of ${contacts.devices} devices` } : null,
    user_training: training.coverage.pairs ? { pct: training.coverage.pct, detail: `${training.coverage.covered} of ${training.coverage.pairs} department and type pairs; ${training.due} refreshers due` } : null,
    id_cards: contacts.devices ? { pct: pctOf(contacts.card, contacts.devices), detail: `${contacts.card} of ${contacts.devices} devices` } : null,
    vendor_contacts: contacts.devices ? { pct: pctOf(contacts.vendor, contacts.devices), detail: `${contacts.vendor} of ${contacts.devices} devices` } : null,
    installation_tests: installed[0]?.n ? { pct: pctOf(installed[0].ok, installed[0].n), detail: `${installed[0].ok} of ${installed[0].n} installed in the period` } : null,
    ppm: { pct: totalOf(ppm, "ppm", "compliance") },
    calibration: cal.length ? { pct: calPct, detail: `${cal.length} devices need calibration` } : null,
    electrical_safety: { pct: totalOf(safety, "classes", "inDatePct") },
    malfunction_history: { count: jobs[0]?.n ?? 0 },
    incidents: incs[0]?.n ? { pct: pctOf(incs[0].acted, incs[0].n), detail: `${incs[0].acted} of ${incs[0].n} incidents` } : { count: 0, pct: 100, detail: "No incidents in the period" },
    recalls: (() => { const p = totalOf(recall, "recalls", "donePct"); return p == null ? { pct: 100, detail: "No devices named in recalls" } : { pct: p }; })(),
    // Wave 41: EFS.11 utilities and EFS.12 water from /buildings/utilities and /buildings/water.
    utility_inventory: { count: util.systems, detail: `${util.critical} critical` },
    utility_tests: util.testsDue ? { pct: pctOf(util.testsInDate, util.testsDue), detail: `${util.testsInDate} of ${util.testsDue} scheduled tests` } : null,
    generator_tests: util.generators ? { pct: pctOf(util.generatorsBoth, util.generators), detail: `${util.generatorsBoth} of ${util.generators} generators` } : null,
    cold_chain: util.coldLogs ? { pct: pctOf(util.coldLogs - util.coldExcursions, util.coldLogs), detail: `${util.coldExcursions} of ${util.coldLogs} logs out of range` } : util.coldChain ? { pct: 0, detail: "No temperature logs in the period" } : null,
    utility_failures: util.failedTests ? { pct: pctOf(util.failedWithJob, util.failedTests), detail: `${util.failedWithJob} of ${util.failedTests} failed tests` } : util.systems ? { pct: 100, detail: "No failed tests in the period" } : null,
    utility_backup: backups.length ? { pct: pctOf(backups.filter((b) => b.state === "ok").length, backups.length), detail: `${backups.filter((b) => b.state === "ok").length} of ${backups.length} settings` } : null,
    water_points: { count: util.points },
    water_sampling: util.points ? { pct: pctOf(util.pointsInDate, util.points), detail: `${util.pointsInDate} of ${util.points} points` } : null,
    dialysis_water: util.dialysisPoints ? { pct: pctOf(util.dialysisSampled, util.dialysisPoints), detail: `${util.dialysisSampled} of ${util.dialysisPoints} dialysis points` } : null,
    water_failures: util.sampleFails ? { pct: pctOf(util.sampleFailsWithJob, util.sampleFails), detail: `${util.sampleFailsWithJob} of ${util.sampleFails} results over the limit` } : util.samples ? { pct: 100, detail: `No result over the limit in ${util.samples} samples` } : null,
    imaging_qc_physicist: noRad ? null : { pct: pctOf(qcOk, radDevices.length), detail: `${qcOk} of ${radDevices.length} radiation devices` },
    dosimetry: noRad ? null : { count: doses[0]?.n ?? 0 },
    ppe: items.length ? { pct: pctOf(ppeOk, items.length), detail: `${ppeOk} of ${items.length} items` } : noRad ? null : { pct: 0, detail: "No protective items on record" },
    radiation_equipment: noRad ? null : { pct: pctOf(radEquipOk, radDevices.length), detail: `${radEquipOk} of ${radDevices.length} radiation devices` },
    radiation_licences: licences.length ? { pct: pctOf(licences.filter((l) => l.expiresOn >= today).length, licences.length) } : noRad ? null : { pct: 0, detail: "No licence on record" },
  };
}

/** KPI values for an equipment plan review of one hospital and period (null = no figure). */
export async function planKpiValues(facilityId: number, from: string, to: string, today: string): Promise<Record<KpiKey, number | null>> {
  const c = ctxFor(facilityId, [facilityId], from, to, today);
  const [ppm, safety, recall, training, cal, harm, live] = await Promise.all([
    ppmComplianceReport(c), electricalSafetyReport(c), recallsReport(c), trainingFigures(c),
    calibrationDevices([facilityId], today, { facilityId }),
    db.select({ n: sql<number>`count(*)::int` }).from(incidents).where(and(eq(incidents.facilityId, facilityId), inArray(incidents.harm, ["MINOR", "SERIOUS", "DEATH"]),
      gte(sql`${incidents.occurredAt}::date`, from), lte(sql`${incidents.occurredAt}::date`, to))),
    twinLive(facilityId).catch(() => null),
  ]);
  return {
    ppm_on_time: totalOf(ppm, "ppm", "compliance"),
    calibration_on_time: calibrationCompliance(cal.map((d) => d.state)).pct,
    safety_tests_on_time: totalOf(safety, "classes", "inDatePct"),
    incidents: harm[0]?.n ?? 0,
    recalls_closed: totalOf(recall, "recalls", "donePct"),
    training_coverage: training.coverage.pct,
    uptime: live && live.rows.length ? equipmentFigures(live.rows).availabilityPct : null,
  };
}

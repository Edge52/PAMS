import "server-only";
/** Database side of routine imaging QC (wave 40). Rules are pure in ./imaging-qc. */
import { and, asc, desc, eq, gte, inArray, like, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, imagingQcRecords, imagingQcReviews, imagingQcTemplates } from "@/db/schema";
import { addDays } from "./dates";
import { holidayDates } from "../holidays-server";
import { dueState, monthFigures, modalityOf, QC_CODE_PATTERNS, type DueState, type Frequency, type Modality } from "./imaging-qc";

/** Scanners of a hospital that have a routine QC modality, not disposed. */
export async function qcScanners(facilityId: number) {
  const rows = await db.select({
    id: assets.id, tag: assets.assetTag, typeCode: deviceTypes.code, typeName: deviceTypes.name, model: assets.model, manufacturer: assets.manufacturer,
    departmentId: assets.departmentId, departmentName: departments.name, status: assets.status,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(eq(assets.facilityId, facilityId), ne(assets.status, "DISPOSED"), or(...QC_CODE_PATTERNS.map((p) => like(deviceTypes.code, p)))))
    .orderBy(asc(assets.assetTag)).limit(1000);
  return rows.flatMap((r) => { const m = modalityOf(r.typeCode); return m ? [{ ...r, modality: m as Modality }] : []; });
}

export async function qcTemplates(facilityId: number, activeOnly = true) {
  return db.select().from(imagingQcTemplates).where(and(eq(imagingQcTemplates.facilityId, facilityId), activeOnly ? eq(imagingQcTemplates.active, true) : undefined))
    .orderBy(asc(imagingQcTemplates.modality), asc(imagingQcTemplates.frequency), asc(imagingQcTemplates.name));
}

/** The due list: every scanner × active template of its modality, with the last run and its state. */
export async function qcDueList(facilityId: number, today: string) {
  const [scanners, templates] = await Promise.all([qcScanners(facilityId), qcTemplates(facilityId)]);
  const ids = scanners.map((s) => s.id);
  const last = ids.length ? await db.selectDistinctOn([imagingQcRecords.assetId, imagingQcRecords.templateId], {
    assetId: imagingQcRecords.assetId, templateId: imagingQcRecords.templateId, on: imagingQcRecords.performedOn, passed: imagingQcRecords.passed,
  }).from(imagingQcRecords).where(and(inArray(imagingQcRecords.assetId, ids), gte(imagingQcRecords.performedOn, addDays(today, -400))))
    .orderBy(imagingQcRecords.assetId, imagingQcRecords.templateId, desc(imagingQcRecords.performedOn), desc(imagingQcRecords.id)) : [];
  const lastOf = new Map(last.map((l) => [`${l.assetId}:${l.templateId}`, l]));
  const rows = scanners.flatMap((s) => templates.filter((t) => t.modality === s.modality).map((t) => {
    const l = lastOf.get(`${s.id}:${t.id}`) ?? null;
    return { scanner: s, template: t, lastOn: l?.on ?? null, lastPassed: l?.passed ?? null, state: dueState(t.frequency as Frequency, l?.on ?? null, today) as DueState };
  }));
  const order: Record<DueState, number> = { overdue: 0, never: 1, due: 2, done: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || a.scanner.tag.localeCompare(b.scanner.tag));
  return { scanners, templates, rows };
}

/** A department's month for the review: per scanner and template, runs, failures and missed periods. */
export async function qcMonth(facilityId: number, month: string, today: string) {
  const { scanners, templates } = await qcDueList(facilityId, today);
  const ids = scanners.map((s) => s.id);
  const runs = ids.length ? await db.select({ assetId: imagingQcRecords.assetId, templateId: imagingQcRecords.templateId, performedOn: imagingQcRecords.performedOn, passed: imagingQcRecords.passed })
    .from(imagingQcRecords).where(and(inArray(imagingQcRecords.assetId, ids), gte(imagingQcRecords.performedOn, `${month}-01`)))
    .limit(20000) : [];
  const reviews = await db.select().from(imagingQcReviews).where(and(eq(imagingQcReviews.facilityId, facilityId), eq(imagingQcReviews.month, month)));
  // Wave 43: daily QC isn't expected on the hospital's public holidays.
  const hols = await holidayDates(facilityId, `${month}-01`, `${month}-31`);
  const depts = new Map<number | null, { id: number | null; name: string; lines: { tag: string; template: string; runs: number; failed: number; missed: number }[] }>();
  for (const s of scanners) {
    for (const t of templates.filter((x) => x.modality === s.modality)) {
      const f = monthFigures(t.frequency as Frequency, month, runs.filter((r) => r.assetId === s.id && r.templateId === t.id), today, hols);
      const d = depts.get(s.departmentId) ?? { id: s.departmentId, name: s.departmentName ?? "No department", lines: [] };
      d.lines.push({ tag: s.tag, template: t.name, ...f });
      depts.set(s.departmentId, d);
    }
  }
  return [...depts.values()].map((d) => ({
    ...d, review: reviews.find((r) => r.departmentId === d.id) ?? null,
    runs: d.lines.reduce((s, l) => s + l.runs, 0), failed: d.lines.reduce((s, l) => s + l.failed, 0), missed: d.lines.reduce((s, l) => s + l.missed, 0),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

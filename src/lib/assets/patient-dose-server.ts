import "server-only";
/**
 * Database side of patient dose and DRLs (wave 43). Rules are pure in ./patient-dose. Reads tolerate a database
 * without the wave 43 tables (`isMissingTable`), so the GAHAR pack keeps working before the migration runs.
 */
import { and, asc, desc, eq, gte, inArray, like, lt, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { assetAeTitles, assets, deviceTypes, doseRecords, doseReferenceLevels, doseReviews } from "@/db/schema";
import { isMissingTable } from "@/lib/notifications/prefs-server";
import { scopeWhere, type Scope } from "./access";
import {
  checkGroups, doseEvidence, doseModalityOf, lastMonths, monthAfter, monthlyGroups, reviewKey,
  type AgeGroup, type DoseLookups, type DoseModality, type DoseRecord, type Drl, type DoseQuantity, type GroupCheck,
} from "./patient-dose";

export type DoseScanner = { id: number; tag: string; serial: string | null; facilityId: number; typeName: string; modality: DoseModality };

/** X-ray devices (CT, radiography, fluoroscopy, mammography) in scope that are not disposed. */
export async function doseScanners(scope: Scope, facilityId?: number): Promise<DoseScanner[]> {
  if (scope !== null && scope.length === 0) return [];
  const rows = await db.select({ id: assets.id, tag: assets.assetTag, serial: assets.serialNumber, facilityId: assets.facilityId, typeName: deviceTypes.name, code: deviceTypes.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(like(deviceTypes.code, "IMG-%"), ne(assets.status, "DISPOSED"), scopeWhere(assets.facilityId, scope), facilityId ? eq(assets.facilityId, facilityId) : undefined))
    .orderBy(asc(assets.assetTag));
  return rows.flatMap((r) => { const m = doseModalityOf(r.code); return m ? [{ id: r.id, tag: r.tag, serial: r.serial, facilityId: r.facilityId, typeName: r.typeName, modality: m }] : []; });
}

/** Scanners by asset tag, serial number and AE title (lower case), for the import. */
export async function doseLookups(scope: Scope): Promise<DoseLookups> {
  const scanners = await doseScanners(scope);
  const byId = new Map(scanners.map((s) => [s.id, s]));
  const aes = scanners.length ? await db.select({ ae: assetAeTitles.aeTitle, assetId: assetAeTitles.assetId }).from(assetAeTitles).where(inArray(assetAeTitles.assetId, scanners.map((s) => s.id))) : [];
  const map: DoseLookups["scanners"] = new Map();
  const put = (k: string | null | undefined, s: DoseScanner) => { if (k && k.trim() && !map.has(k.trim().toLowerCase())) map.set(k.trim().toLowerCase(), { assetId: s.id, facilityId: s.facilityId, modality: s.modality }); };
  for (const s of scanners) put(s.tag, s);
  for (const a of aes) put(a.ae, byId.get(a.assetId)!);
  for (const s of scanners) put(s.serial, s);
  return { scanners: map };
}

export type DrlRow = typeof doseReferenceLevels.$inferSelect;
export const asDrl = (d: DrlRow): Drl => ({ id: d.id, facilityId: d.facilityId, modality: d.modality as DoseModality, examType: d.examType, ageGroup: d.ageGroup as AgeGroup, quantity: d.quantity as DoseQuantity, value: d.value, active: d.active });

export async function drlsFor(facilityIds: number[] | null): Promise<DrlRow[]> {
  if (facilityIds !== null && facilityIds.length === 0) return [];
  return db.select().from(doseReferenceLevels).where(facilityIds === null ? undefined : inArray(doseReferenceLevels.facilityId, facilityIds))
    .orderBy(asc(doseReferenceLevels.modality), asc(doseReferenceLevels.examType), asc(doseReferenceLevels.ageGroup), asc(doseReferenceLevels.quantity));
}

export const asRecord = (r: typeof doseRecords.$inferSelect): DoseRecord => ({
  assetId: r.assetId, facilityId: r.facilityId, examDate: r.examDate, modality: r.modality as DoseModality, examType: r.examType, ageGroup: r.ageGroup as AgeGroup,
  ctdivol: r.ctdivol, dlp: r.dlp, dap: r.dap, esd: r.esd, time: r.fluoroTime, agd: r.agd,
});

export type ReviewRow = typeof doseReviews.$inferSelect;

/** Monthly medians against the DRLs, for the months from `fromMonth` to `toMonth` (YYYY-MM), with their reviews. */
export async function doseChecks(facilityIds: number[] | null, fromMonth: string, toMonth: string): Promise<{ checks: GroupCheck[]; reviews: Map<string, ReviewRow> }> {
  if (facilityIds !== null && facilityIds.length === 0) return { checks: [], reviews: new Map() };
  const fac = (c: Parameters<typeof inArray>[0]) => (facilityIds === null ? undefined : inArray(c, facilityIds));
  const [recs, drls, revs] = await Promise.all([
    db.select().from(doseRecords).where(and(fac(doseRecords.facilityId), gte(doseRecords.examDate, `${fromMonth}-01`), lt(doseRecords.examDate, monthAfter(toMonth)))).limit(200_000),
    drlsFor(facilityIds),
    db.select().from(doseReviews).where(and(fac(doseReviews.facilityId), gte(doseReviews.month, fromMonth), lte(doseReviews.month, toMonth))).orderBy(desc(doseReviews.reviewedOn)),
  ]);
  const checks = checkGroups(monthlyGroups(recs.map(asRecord)), drls.map(asDrl));
  const reviews = new Map(revs.map((r) => [reviewKey({ assetId: r.assetId, modality: r.modality, key: r.examKey, ageGroup: r.ageGroup, month: r.month }), r]));
  return { checks, reviews };
}

/**
 * GAHAR DAS.09 patient dose: the last 12 months' groups compared with a DRL. null when the tables are not there
 * yet; otherwise the counts and the hospital's DRL count.
 */
export async function patientDoseEvidence(facilityIds: number[] | null, today: string) {
  try {
    const months = lastMonths(today, 12);
    const [{ checks, reviews }, drls, recs] = await Promise.all([
      doseChecks(facilityIds, months.at(-1)!, months[0]),
      drlsFor(facilityIds),
      facilityIds !== null && facilityIds.length === 0 ? Promise.resolve([]) : db.select({ id: doseRecords.id }).from(doseRecords)
        .where(and(facilityIds === null ? undefined : inArray(doseRecords.facilityId, facilityIds), gte(doseRecords.examDate, `${months.at(-1)}-01`))).limit(1),
    ]);
    const active = drls.filter((d) => d.active);
    return { ...doseEvidence(checks, new Set(reviews.keys())), drls: active.length, exampleDrls: active.filter((d) => d.isExample).length, anyRecords: recs.length > 0 };
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

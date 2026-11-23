import "server-only";
/**
 * Database side of imported daily exam counts (wave 38). Rules are pure in ./exam-import. Saving replaces the
 * device-days in the file and copies the month totals into imaging_usage, so the Imaging use page and the
 * usage-based PPM (meters-server, `readingsFromMonthlyCounts`) read the imported figures without a second store.
 */
import { and, asc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetAeTitles, assets, deviceTypes, examCounts, imagingUsage } from "@/db/schema";
import { addDays, endOfMonth } from "./dates";
import { deviceDays, monthTotals, utilisation, type ExamLookups, type ValidExam } from "./exam-import";
import { scopeWhere, type Scope } from "./access";

/** Tags and AE titles of the imaging devices the user can see. */
export async function examLookups(scope: Scope): Promise<ExamLookups> {
  const [devs, aes] = await Promise.all([
    db.select({ assetId: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(like(deviceTypes.code, "IMG-%"), sql`${assets.status} <> 'DISPOSED'`, scopeWhere(assets.facilityId, scope))),
    db.select({ ae: assetAeTitles.aeTitle, assetId: assetAeTitles.assetId }).from(assetAeTitles).innerJoin(assets, eq(assets.id, assetAeTitles.assetId))
      .where(scopeWhere(assets.facilityId, scope)),
  ]);
  const byId = new Map(devs.map((d) => [d.assetId, d]));
  return {
    byTag: new Map(devs.map((d) => [d.tag.toUpperCase(), d])),
    byAe: new Map(aes.flatMap((a) => (byId.has(a.assetId) ? [[a.ae, byId.get(a.assetId)!] as const] : []))),
  };
}

/**
 * Replace the device-days in `valid` and refresh the month totals in imaging_usage. Takes a transaction-capable db;
 * call the permission and scope checks before. Returns the months touched per device.
 */
export async function saveExamCounts(valid: ValidExam[], source: string, who: string) {
  const keys = deviceDays(valid);
  const byAsset = new Map<number, string[]>();
  for (const k of keys) { const [a, d] = k.split("|"); (byAsset.get(Number(a)) ?? byAsset.set(Number(a), []).get(Number(a))!).push(d); }
  const months = new Map<number, Set<string>>();
  for (const [a, ds] of byAsset) months.set(a, new Set(ds.map((d) => `${d.slice(0, 7)}-01`)));
  await db.transaction(async (tx) => {
    for (const [a, ds] of byAsset) await tx.delete(examCounts).where(and(eq(examCounts.assetId, a), inArray(examCounts.day, ds)));
    for (let i = 0; i < valid.length; i += 500) {
      await tx.insert(examCounts).values(valid.slice(i, i + 500).map((v) => ({ assetId: v.assetId, day: v.day, procedure: v.procedure, modality: v.modality, exams: v.exams, source, importedByName: who })));
    }
    // Month totals from every imported day of those months (not just this file's).
    for (const [a, ms] of months) {
      for (const m of ms) {
        const rows = await tx.select({ day: examCounts.day, exams: examCounts.exams }).from(examCounts)
          .where(and(eq(examCounts.assetId, a), gte(examCounts.day, m), sql`${examCounts.day} <= ${endOfMonth(m)}`));
        const total = monthTotals(rows).get(m) ?? 0;
        const v = { exams: total, notes: "From imported daily counts", enteredByName: who, updatedAt: new Date() };
        await tx.insert(imagingUsage).values({ assetId: a, month: m, ...v }).onConflictDoUpdate({ target: [imagingUsage.assetId, imagingUsage.month], set: v });
      }
    }
  });
  return { deviceDays: keys.length, devices: byAsset.size, months: [...months.values()].reduce((s, m) => s + m.size, 0) };
}

/** Use of one device from its imported daily counts, for the asset page. */
export async function examUseFor(assetId: number, today: string) {
  const since = addDays(today, -7 * 12 + 1);
  const [rows, aes, [last]] = await Promise.all([
    db.select({ day: examCounts.day, exams: sql<number>`sum(${examCounts.exams})::int` }).from(examCounts)
      .where(and(eq(examCounts.assetId, assetId), gte(examCounts.day, since))).groupBy(examCounts.day).orderBy(asc(examCounts.day)),
    db.select({ ae: assetAeTitles.aeTitle }).from(assetAeTitles).where(eq(assetAeTitles.assetId, assetId)).orderBy(asc(assetAeTitles.aeTitle)),
    db.select({ day: sql<string | null>`max(${examCounts.day})` }).from(examCounts).where(eq(examCounts.assetId, assetId)),
  ]);
  // Windows end on the last imported day, so a week not yet exported doesn't look like a fall.
  const end = last?.day && last.day < today ? last.day : today;
  return { use: utilisation(rows.map((r) => ({ day: r.day, exams: Number(r.exams) })), end), aeTitles: aes.map((a) => a.ae), lastDay: last?.day ?? null };
}

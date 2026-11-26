import "server-only";
/**
 * Analytics › Imaging, database side (wave 40). Monthly totals from `imaging_usage` (typed in, imported, or copied from
 * the daily file import); daily counts from `exam_counts` for the weekday × month heatmap.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, examCounts, facilities, imagingUsage, typeCapacity } from "@/db/schema";
import { CAPACITY_HINTS } from "@/lib/assets/planning";
import type { Filters } from "./core";
import { byModality, scannerCapacity, weekdayMonthHeatmap } from "./imaging";

const MAX_SCANNERS = 500;

export type ImagingAnalytics = Awaited<ReturnType<typeof imagingAnalytics>>;

export async function imagingAnalytics(ids: number[], f: Filters) {
  const empty = { scanners: [], modalities: [], heat: weekdayMonthHeatmap([]), truncated: false };
  if (!ids.length) return empty;
  const list = await db.select({ id: assets.id, tag: assets.assetTag, typeId: deviceTypes.id, typeCode: deviceTypes.code, typeName: deviceTypes.name, facility: facilities.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .where(and(inArray(assets.facilityId, ids), sql`${deviceTypes.code} like 'IMG-%' and ${deviceTypes.code} not like 'IMG-ACC%'`,
      sql`${assets.status} not in ('DISPOSED', 'IN_STOCK')`,
      f.departmentId ? eq(assets.departmentId, f.departmentId) : undefined, f.deviceTypeId ? eq(assets.deviceTypeId, f.deviceTypeId) : undefined))
    .orderBy(asc(deviceTypes.code), asc(assets.assetTag)).limit(MAX_SCANNERS + 1);
  const scanners = list.slice(0, MAX_SCANNERS);
  if (!scanners.length) return empty;
  const sIds = scanners.map((s) => s.id);
  // Months whose first day falls in the period.
  const [use, caps, days] = await Promise.all([
    db.select({ assetId: imagingUsage.assetId, exams: sql<number>`sum(${imagingUsage.exams})::int`, months: sql<number>`count(*)::int` }).from(imagingUsage)
      .where(and(inArray(imagingUsage.assetId, sIds), sql`${imagingUsage.month} >= date_trunc('month', ${f.from}::date)::date and ${imagingUsage.month} <= ${f.to}::date`))
      .groupBy(imagingUsage.assetId),
    db.select().from(typeCapacity).where(inArray(typeCapacity.deviceTypeId, [...new Set(scanners.map((s) => s.typeId))])),
    db.select({ day: examCounts.day, exams: sql<number>`sum(${examCounts.exams})::int` }).from(examCounts)
      .where(and(inArray(examCounts.assetId, sIds), sql`${examCounts.day} between ${f.from}::date and ${f.to}::date`))
      .groupBy(examCounts.day).orderBy(asc(examCounts.day)).limit(4000),
  ]);
  const capOf = new Map(caps.map((c) => [c.deviceTypeId, c.examsPerYear]));
  const rows = scanners.map((s) => {
    const u = use.find((x) => x.assetId === s.id);
    return { ...scannerCapacity({ id: s.id, tag: s.tag, typeCode: s.typeCode, typeName: s.typeName, exams: u?.exams ?? 0, months: u?.months ?? 0, capacityPerYear: capOf.get(s.typeId) ?? null }, CAPACITY_HINTS), facility: s.facility };
  });
  return { scanners: rows, modalities: byModality(rows), heat: weekdayMonthHeatmap(days.map((d) => ({ day: String(d.day), exams: Number(d.exams) }))), truncated: list.length > MAX_SCANNERS };
}

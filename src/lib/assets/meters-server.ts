import "server-only";
/**
 * Database side of usage meters (wave 27): loads readings (or imaging exam counts) for devices whose type has a usage
 * interval and works out when their usage-based PPM falls due. Pages pass the result to `nextPpmDue` as `usageDue`.
 */
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, imagingUsage, meterReadings } from "@/db/schema";
import { IMAGING_UNIT, readingProblem, readingsFromMonthlyCounts, usagePpmDue, type MeterReading, type UsageDue } from "./meters";
import type { Scope } from "./access";
import { scopeWhere } from "./access";

export type UsageInfo = UsageDue & { fromImaging: boolean };

/**
 * Usage-based PPM for devices whose type has a usage interval. `ids` limits it to those devices (pass the rows a page
 * already shows); without ids, every such device in the scope. Devices without a usage interval are not in the map.
 */
export async function usageDueMap(today: string, opts: { ids?: number[]; scope?: Scope } = {}): Promise<Map<number, UsageInfo>> {
  const out = new Map<number, UsageInfo>();
  if (opts.ids && opts.ids.length === 0) return out;
  const few = opts.ids && opts.ids.length <= 1000;
  const list = await db.select({
    id: assets.id, installDate: assets.installDate, purchaseDate: assets.purchaseDate, interval: deviceTypes.usageInterval, unit: deviceTypes.usageUnit,
    lastPpm: sql<string | null>`(select max(m.completed_date) from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status = 'COMPLETED')`,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(isNotNull(deviceTypes.usageInterval), isNotNull(deviceTypes.usageUnit), sql`${assets.status} <> 'DISPOSED'`,
      few ? inArray(assets.id, opts.ids!) : undefined, scopeWhere(assets.facilityId, opts.scope ?? null)));
  const wanted = opts.ids && !few ? new Set(opts.ids) : null;
  const rows = wanted ? list.filter((r) => wanted.has(r.id)) : list;
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const [readings, imaging] = await Promise.all([
    db.select({ id: meterReadings.id, assetId: meterReadings.assetId, readOn: meterReadings.readOn, reading: meterReadings.reading, kind: meterReadings.kind })
      .from(meterReadings).where(inArray(meterReadings.assetId, ids)).orderBy(asc(meterReadings.readOn), asc(meterReadings.id)),
    rows.some((r) => r.unit === IMAGING_UNIT)
      ? db.select({ assetId: imagingUsage.assetId, month: imagingUsage.month, exams: imagingUsage.exams }).from(imagingUsage).where(inArray(imagingUsage.assetId, ids))
      : Promise.resolve([]),
  ]);
  const byAsset = new Map<number, MeterReading[]>();
  for (const r of readings) {
    const l = byAsset.get(r.assetId) ?? [];
    l.push({ id: r.id, readOn: r.readOn, reading: r.reading, kind: r.kind });
    byAsset.set(r.assetId, l);
  }
  const examsBy = new Map<number, { month: string; exams: number }[]>();
  for (const m of imaging) { const l = examsBy.get(m.assetId) ?? []; l.push(m); examsBy.set(m.assetId, l); }
  for (const r of rows) {
    let own = byAsset.get(r.id) ?? [];
    let fromImaging = false;
    // Imaging devices already record monthly exam counts: use them as the meter until the device has readings.
    if (!own.length && r.unit === IMAGING_UNIT && examsBy.has(r.id)) { own = readingsFromMonthlyCounts(examsBy.get(r.id)!, today); fromImaging = true; }
    const u = usagePpmDue({ readings: own, interval: r.interval!, unit: r.unit!, lastPpmDate: r.lastPpm, installDate: r.installDate ?? r.purchaseDate });
    out.set(r.id, { ...u, fromImaging });
  }
  return out;
}

/** One device's readings, newest first, for the asset page. */
export async function meterHistory(assetId: number, limit = 12) {
  return db.select().from(meterReadings).where(eq(meterReadings.assetId, assetId))
    .orderBy(sql`${meterReadings.readOn} desc`, sql`${meterReadings.id} desc`).limit(limit);
}

/* ── Wave 29: a meter reading taken at a maintenance visit ── */

type ReadingTx = Pick<typeof db, "insert">;

/** The device's usage unit and its last reading, or null when its type has no usage meter. */
export async function meterOf(assetId: number): Promise<{ unit: string; last: { readOn: string; reading: number } | null } | null> {
  const [t] = await db.select({ unit: deviceTypes.usageUnit }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  if (!t?.unit) return null;
  const [last] = await db.select({ readOn: meterReadings.readOn, reading: meterReadings.reading }).from(meterReadings)
    .where(eq(meterReadings.assetId, assetId)).orderBy(sql`${meterReadings.readOn} desc`, sql`${meterReadings.id} desc`).limit(1);
  return { unit: t.unit, last: last ?? null };
}

/**
 * Check the optional meter reading typed when a visit is signed off (`meterReading` in the form). Returns the save
 * step to run with the visit's own writes, or the problem to show beside the field. Blank, or a device without a
 * usage meter: nothing to save.
 */
export async function readingAtVisit(fd: FormData, assetId: number, on: string, who: { id: number; name: string }):
  Promise<{ save: (tx: ReadingTx) => Promise<void> } | { problem: string }> {
  const raw = String(fd.get("meterReading") ?? "").trim();
  const none = { save: async () => {} };
  if (!raw) return none;
  const meter = await meterOf(assetId);
  if (!meter) return none;
  const reading = Number(raw);
  const existing = await db.select({ id: meterReadings.id, readOn: meterReadings.readOn, reading: meterReadings.reading, kind: meterReadings.kind })
    .from(meterReadings).where(eq(meterReadings.assetId, assetId)).orderBy(asc(meterReadings.readOn), asc(meterReadings.id));
  const problem = readingProblem(existing, { readOn: on, reading, kind: "READING" });
  if (problem) return { problem };
  return { save: async (tx) => { await tx.insert(meterReadings).values({ assetId, readOn: on, reading, unit: meter.unit, kind: "READING", note: "At the maintenance visit", enteredById: who.id, enteredByName: who.name }); } };
}

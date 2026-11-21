import "server-only";
/**
 * Device status by day (wave 16): the hourly background job stores today's changes; the first run rebuilds the past
 * year from work orders' downtime. Today's row keeps the worst status seen that day (out of service, then under
 * maintenance), counting work orders' downtime today, so a same-day outage isn't lost (wave 35, audit A8).
 * Idempotent: running it twice in a day with nothing new stores nothing.
 */
import { and, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetStatusDays, workOrders } from "@/db/schema";
import { addDaysISO, APP_TIME_ZONE, todayISO } from "@/lib/format";
import { reconstructDays, snapshotWrites } from "./status-history";

const BACKFILL_DAYS = 365;
type Status = (typeof assetStatusDays.$inferInsert)["status"];

export async function snapshotStatuses(now: Date = new Date()): Promise<{ stored: number; rebuilt: number }> {
  const today = todayISO(now);
  const current = await db.select({ assetId: assets.id, status: assets.status }).from(assets);
  let rebuilt = 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assetStatusDays);
  if (n === 0) {
    // First run: rebuild the past from downtime periods, so History has something to replay from day one.
    const from = addDaysISO(today, -BACKFILL_DAYS);
    const dts = await db.select({ assetId: workOrders.assetId, start: workOrders.downtimeStart, end: workOrders.downtimeEnd }).from(workOrders)
      .where(and(isNotNull(workOrders.downtimeStart), sql`coalesce(${workOrders.downtimeEnd}, now()) >= ${from}::date`));
    const rows = reconstructDays(dts.map((d) => ({ assetId: d.assetId, start: todayISO(d.start!), end: d.end ? todayISO(d.end) : null })),
      new Map(current.map((c) => [c.assetId, c.status])), from, today);
    for (let i = 0; i < rows.length; i += 1000) {
      await db.insert(assetStatusDays).values(rows.slice(i, i + 1000).map((r) => ({ assetId: r.assetId, day: r.day, status: r.status as Status, source: "reconstructed" }))).onConflictDoNothing();
    }
    rebuilt = rows.length;
  }
  // Latest stored row per device, and today's rows: today's keeps the worst status seen that day (audit A8).
  const [latest, todays, down] = await Promise.all([
    db.execute<{ asset_id: number; status: string }>(sql`select distinct on (asset_id) asset_id, status::text as status from ${assetStatusDays} order by asset_id, day desc`),
    db.execute<{ asset_id: number; status: string }>(sql`select asset_id, status::text as status from ${assetStatusDays} where day = ${today}::date`),
    // Devices with downtime on today's date in the hospital's time zone, so an outage between two runs still shows.
    db.selectDistinct({ assetId: workOrders.assetId }).from(workOrders).where(and(isNotNull(workOrders.downtimeStart), sql`${workOrders.status} <> 'CANCELLED'`,
      sql`(${workOrders.downtimeStart} at time zone ${APP_TIME_ZONE})::date <= ${today}::date`,
      sql`(coalesce(${workOrders.downtimeEnd}, ${now.toISOString()}::timestamptz) at time zone ${APP_TIME_ZONE})::date >= ${today}::date`)),
  ]);
  const changes = snapshotWrites(current, new Map(latest.rows.map((r) => [Number(r.asset_id), String(r.status)])),
    new Map(todays.rows.map((r) => [Number(r.asset_id), String(r.status)])), new Set(down.map((r) => r.assetId)));
  for (let i = 0; i < changes.length; i += 1000) {
    await db.insert(assetStatusDays).values(changes.slice(i, i + 1000).map((c) => ({ assetId: c.assetId, day: today, status: c.status as Status, source: "snapshot" })))
      .onConflictDoUpdate({ target: [assetStatusDays.assetId, assetStatusDays.day], set: { status: sql`excluded.status`, source: sql`excluded.source` } });
  }
  return { stored: changes.length, rebuilt };
}

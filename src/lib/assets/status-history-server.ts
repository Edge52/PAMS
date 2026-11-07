import "server-only";
/**
 * Device status by day (wave 16): the hourly background job stores today's changes; the first run rebuilds the past
 * year from work orders' downtime. Idempotent: running it twice in a day stores nothing new.
 */
import { and, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, assetStatusDays, workOrders } from "@/db/schema";
import { addDaysISO, todayISO } from "@/lib/format";
import { changesToday, reconstructDays } from "./status-history";

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
  // Latest stored status per device (today's row counts, so a second run the same day only stores further changes).
  const latest = await db.execute<{ asset_id: number; status: string }>(sql`select distinct on (asset_id) asset_id, status from ${assetStatusDays} order by asset_id, day desc`);
  const changes = changesToday(current, new Map(latest.rows.map((r) => [Number(r.asset_id), String(r.status)])));
  for (let i = 0; i < changes.length; i += 1000) {
    await db.insert(assetStatusDays).values(changes.slice(i, i + 1000).map((c) => ({ assetId: c.assetId, day: today, status: c.status as Status, source: "snapshot" })))
      .onConflictDoUpdate({ target: [assetStatusDays.assetId, assetStatusDays.day], set: { status: sql`excluded.status`, source: sql`excluded.source` } });
  }
  return { stored: changes.length, rebuilt };
}

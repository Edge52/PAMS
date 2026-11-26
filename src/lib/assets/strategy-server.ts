import "server-only";
/**
 * Maintenance strategy guard (wave 39), database side: the hospital's own history with each device type and the
 * written evidence for an alternative schedule. Rules are pure in ./risk.ts.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, maintenanceEvents, strategyEvidence } from "@/db/schema";
import { todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { scopeWhere } from "./access";
import { monthsBetween, type FleetHistory, type HistoryRule } from "./risk";

/** Per device type: months since the newest device was installed (install, else purchase date) and the fewest
 *  completed planned visits on any of its devices. Disposed devices don't count. `scope` null = every hospital. */
export async function fleetHistory(typeIds: number[], scope: number[] | null = null, today = todayISO()): Promise<Map<number, FleetHistory>> {
  const out = new Map<number, FleetHistory>();
  if (!typeIds.length) return out;
  const rows = await db.select({
    typeId: assets.deviceTypeId, installed: sql<string | null>`coalesce(${assets.installDate}, ${assets.purchaseDate})`,
    ppms: sql<number>`(select count(*)::int from ${maintenanceEvents} where ${maintenanceEvents.assetId} = ${assets.id} and ${maintenanceEvents.type} = 'PPM' and ${maintenanceEvents.status} = 'COMPLETED')`,
  }).from(assets).where(and(inArray(assets.deviceTypeId, typeIds), ne(assets.status, "DISPOSED"), scopeWhere(assets.facilityId, scope)));
  for (const r of rows) {
    const cur = out.get(r.typeId) ?? { newestMonths: null, fewestPpms: null };
    const m = r.installed ? monthsBetween(String(r.installed).slice(0, 10), today) : null;
    if (m != null && (cur.newestMonths == null || m < cur.newestMonths)) cur.newestMonths = m;
    const n = Number(r.ppms);
    if (cur.fewestPpms == null || n < cur.fewestPpms) cur.fewestPpms = n;
    out.set(r.typeId, cur);
  }
  return out;
}

export async function historyRule(): Promise<HistoryRule> {
  const s = await getSettings();
  return { minMonths: s.strategyMinMonthsInstalled, minPpms: s.strategyMinPpms };
}

export async function evidenceFor(typeIds: number[]): Promise<Map<number, string>> {
  if (!typeIds.length) return new Map();
  const rows = await db.select().from(strategyEvidence).where(inArray(strategyEvidence.deviceTypeId, typeIds));
  return new Map(rows.map((r) => [r.deviceTypeId, r.evidence]));
}

/** Save or clear a type's evidence (inside the caller's transaction when given). */
export async function saveEvidence(deviceTypeId: number, evidence: string | null, byName: string, x: Pick<typeof db, "insert" | "delete"> = db) {
  if (!evidence) { await x.delete(strategyEvidence).where(eq(strategyEvidence.deviceTypeId, deviceTypeId)); return; }
  await x.insert(strategyEvidence).values({ deviceTypeId, evidence, updatedByName: byName })
    .onConflictDoUpdate({ target: strategyEvidence.deviceTypeId, set: { evidence, updatedByName: byName } });
}

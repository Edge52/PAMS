import "server-only";
/**
 * Analytics › Lifecycle, database side (wave 40). Due years come from the capital plan's rules (`plannedYear`: the
 * replacement score, the end of the device's life and the maker's end of support), costs from `replacementPlan`
 * (device type price range at today's USD rate, else the purchase cost), so both pages agree.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, capitalScenarios, deviceModels } from "@/db/schema";
import { replacementPlan } from "@/lib/assets/lifecycle-server";
import { plannedYear } from "@/lib/assets/planning";
import { cleanSettings, type PlanDevice } from "./capital-whatif";
import type { Filters } from "./core";

/** Devices in use with the budget year each is due for replacement (null = nothing says when, left out). */
export async function planDevices(ids: number[], f: Filters, thisYear: number): Promise<PlanDevice[]> {
  if (!ids.length) return [];
  const where = and(inArray(assets.facilityId, ids), f.departmentId ? eq(assets.departmentId, f.departmentId) : undefined, f.deviceTypeId ? eq(assets.deviceTypeId, f.deviceTypeId) : undefined);
  const [plan, eos] = await Promise.all([
    replacementPlan(where),
    db.select({ id: assets.id, eos: deviceModels.endOfSupport }).from(assets).innerJoin(deviceModels, and(eq(deviceModels.deviceTypeId, assets.deviceTypeId),
      sql`lower(trim(${assets.manufacturer})) = lower(${deviceModels.manufacturer}) and lower(trim(${assets.model})) = lower(${deviceModels.model})`))
      .where(and(where, sql`${deviceModels.endOfSupport} is not null`)).limit(20_000),
  ]);
  const eosOf = new Map(eos.map((e) => [e.id, e.eos]));
  const out: PlanDevice[] = [];
  for (const r of plan) {
    const { year } = plannedYear({ band: r.score.band, installDate: r.installDate, lifeYears: r.lifeYears, endOfSupport: eosOf.get(r.id) ?? null }, thisYear);
    if (year == null) continue;
    out.push({ id: r.id, tag: r.tag, typeCode: r.typeCode, typeName: r.typeName, dueYear: year, cost: r.estimateEgp, score: r.score.score });
  }
  return out;
}

export async function scenariosFor(ids: number[]) {
  if (!ids.length) return [];
  const rows = await db.select().from(capitalScenarios).where(inArray(capitalScenarios.facilityId, ids)).orderBy(desc(capitalScenarios.updatedAt)).limit(100);
  return rows.map((r) => ({ ...r, settings: cleanSettings(r.settings) }));
}

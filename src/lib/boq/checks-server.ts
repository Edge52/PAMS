import "server-only";
/** BOQ checks: fit to budget, benchmarks and risk flags for one BOQ (the rules are pure, in fit-budget/benchmarks/risks). */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { formatMoney, num } from "@/lib/format";
import { convert } from "@/lib/server-utils";
import { checkBenchmarks } from "./benchmarks";
import { fitToBudget, type FitLine } from "./fit-budget";
import { effectiveTier, PRICE_TIERS, tierPriceUsd, type PriceTier } from "./pricing";
import type { BoqWorkspace } from "./queries";
import { riskFlags, type FleetRow } from "./risks";

/** Device groups whose fleet in the register is checked for single-maker risk (life-critical). */
const FLEET_PREFIXES = ["LIF-VEN-", "LIF-DEF-", "LIF-ANE-", "MON-PAT-", "INF-PMP-", "THR-HD-", "LIF-NEO-INC"];

export async function fitLines(ws: BoqWorkspace): Promise<FitLine[] | null> {
  const rate = ws.boq.currency === "USD" ? 1 : await convert(1, "USD", ws.boq.currency);
  if (rate == null) return null;
  const deptTier = new Map(ws.depts.map((d) => [d.id, d.priceTier as PriceTier | null]));
  const deptLabel = new Map(ws.depts.map((d) => [d.id, d.label]));
  return ws.lines.map((l) => ({
    id: l.id, name: l.deviceName, department: l.boqDepartmentId != null ? deptLabel.get(l.boqDepartmentId) ?? "Department" : "Hospital-wide",
    tier: l.tier, quantity: l.quantity, unitPrice: num(l.unitPriceEstimate), priceManual: l.priceManual,
    priceTier: effectiveTier(l.priceTier as PriceTier | null, l.boqDepartmentId != null ? deptTier.get(l.boqDepartmentId) : null, ws.boq.priceTier as PriceTier),
    tierPrices: Object.fromEntries(PRICE_TIERS.map((t) => {
      const usd = tierPriceUsd(l.priceMinUsd, l.priceMaxUsd, t);
      return [t, usd == null ? null : Math.round(usd * rate * 100) / 100];
    })) as Record<PriceTier, number | null>,
  }));
}

export async function boqChecks(ws: BoqWorkspace) {
  const { boq, totals } = ws;
  const target = boq.targetBudget != null ? num(boq.targetBudget) : null;
  const lines = await fitLines(ws);
  const fit = target != null && lines ? fitToBudget(lines, target, boq.contingencyPct) : null;
  const benchmarks = checkBenchmarks(ws.depts, ws.lines.map((l) => ({ boqDepartmentId: l.boqDepartmentId, deviceCode: l.deviceCode, quantity: l.quantity })), boq.totalHospitalBeds ?? 0);

  // The hospital's current fleet of life-critical types this BOQ buys more of.
  let fleet: FleetRow[] = [];
  const codes = [...new Set(ws.lines.filter((l) => l.quantity > 0 && FLEET_PREFIXES.some((p) => l.deviceCode.startsWith(p) || l.deviceCode === p)).map((l) => l.deviceCode))];
  if (boq.facilityId && codes.length) {
    const rows = await db.select({ name: deviceTypes.name, units: sql<number>`count(*)::int`, makers: sql<number>`count(distinct lower(${assets.manufacturer}))::int`, maker: sql<string | null>`min(${assets.manufacturer})` })
      .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, boq.facilityId), inArray(deviceTypes.code, codes), sql`${assets.status} <> 'DISPOSED'`, sql`${assets.manufacturer} is not null`))
      .groupBy(deviceTypes.name);
    fleet = rows;
  }
  const risks = riskFlags({
    depts: ws.depts, currency: boq.currency, grandTotal: totals.grandTotal, targetBudget: target, unpricedLines: totals.unpricedLines,
    lines: ws.lines.map((l) => ({ boqDepartmentId: l.boqDepartmentId, deviceCode: l.deviceCode, deviceName: l.deviceName, quantity: l.quantity, tier: l.tier, calculatedQty: l.calculatedQty, isOverridden: l.isOverridden, unitPrice: num(l.unitPriceEstimate) })),
    fleet, money: (n) => formatMoney(n, boq.currency, { compact: n >= 1e6 }),
  });
  return { fit, target, benchmarks, risks };
}
export type BoqChecks = Awaited<ReturnType<typeof boqChecks>>;

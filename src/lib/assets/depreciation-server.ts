import "server-only";
/**
 * Database side of depreciation and book value (wave 27). Amounts stay in each asset's currency and are converted to
 * EGP at the exchange rate of the purchase date (audit DL-18); amounts without a rate are left out
 * of EGP totals and their currencies listed.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { acceptances, assets, departments, deviceTypes, facilities } from "@/db/schema";
import { num, todayISO } from "@/lib/format";
import { loadFx } from "@/lib/server-utils";
import { getSetting } from "@/lib/settings";
import { depreciation, depreciationTerms, inServiceDate, type Depreciation, type DepreciationMethod, type StartBasis } from "./depreciation";

export type BookValueRow = {
  id: number; tag: string; status: string; facilityId: number; facility: string; departmentId: number | null; department: string | null;
  typeId: number; typeName: string; typeCode: string; currency: string;
  inService: string | null; basis: StartBasis | null; lifeYears: number | null; residualPct: number;
  dep: Depreciation;
  /** Wave 29: the hospital's method (Administration › Settings). */
  method: DepreciationMethod;
  /** EGP figures; null when the currency has no stored rate (or there is no cost). */
  costEgp: number | null; accumulatedEgp: number | null; bookValueEgp: number | null;
};

const select = {
  id: assets.id, tag: assets.assetTag, status: assets.status, facilityId: assets.facilityId, facility: facilities.name,
  departmentId: assets.departmentId, department: departments.name, typeId: deviceTypes.id, typeName: deviceTypes.name, typeCode: deviceTypes.code,
  cost: assets.purchaseCost, currency: assets.currency, purchaseDate: assets.purchaseDate, installDate: assets.installDate, acceptedOn: acceptances.acceptedOn,
  assetLife: assets.lifeExpectancyYears, typeLife: deviceTypes.lifeExpectancyYears, assetResidual: assets.residualPct, typeResidual: deviceTypes.residualPct,
};

/**
 * Book value of the matching assets on `onDate` (default today). Disposed devices are left out unless `where` asks
 * for them. `rates` may be passed in when the caller already has them.
 */
export async function bookValues(where: SQL | undefined, onDate = todayISO(), includeDisposed = false): Promise<{ rows: BookValueRow[]; missing: string[] }> {
  const list = await db.select(select).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(acceptances, eq(acceptances.assetId, assets.id))
    .where(and(includeDisposed ? undefined : sql`${assets.status} <> 'DISPOSED'`, where));
  const [fx, method] = await Promise.all([loadFx(), getSetting("depreciationMethod")]);
  const missing = new Set<string>();
  const rows = list.map((r): BookValueRow => {
    const start = inServiceDate(r);
    const terms = depreciationTerms({ lifeYears: r.assetLife, residualPct: r.assetResidual }, { lifeYears: r.typeLife, residualPct: r.typeResidual });
    const dep = depreciation({ method, cost: r.cost != null ? num(r.cost) : null, inService: start.date, ...terms }, onDate);
    const currency = r.currency || "EGP";
    // Historical cost (audit DL-18): a foreign-currency purchase is valued at the rate of its purchase date (else the
    // day it went into service), not today's, so book values don't jump when the pound moves.
    const costDate = r.purchaseDate ?? start.date ?? onDate;
    const egp = (v: number | null) => {
      if (v == null) return null;
      const x = fx.toEgp(v, currency, costDate);
      if (x == null && v !== 0) missing.add(currency);
      return x;
    };
    return {
      id: r.id, tag: r.tag, status: r.status, facilityId: r.facilityId, facility: r.facility, departmentId: r.departmentId, department: r.department,
      typeId: r.typeId, typeName: r.typeName, typeCode: r.typeCode, currency, inService: start.date, basis: start.basis,
      lifeYears: terms.lifeYears, residualPct: terms.residualPct, dep, method,
      costEgp: egp(dep.cost), accumulatedEgp: egp(dep.accumulated), bookValueEgp: egp(dep.bookValue),
    };
  });
  return { rows, missing: [...missing].sort() };
}

/** One asset's book value today (the asset page). */
export async function assetBookValue(assetId: number): Promise<BookValueRow | null> {
  const { rows } = await bookValues(eq(assets.id, assetId), todayISO(), true);
  return rows[0] ?? null;
}

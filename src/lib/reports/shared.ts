import "server-only";
import { asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { rateToEgp } from "@/lib/server-utils";
import type { ReportFilters } from "./types";

/**
 * WHERE condition for a facility column: the chosen facility, else every facility in the user's scope.
 * Records without a facility (nullable columns) aren't tied to a site, so scoped users still see them unless they
 * picked a facility. Call facilityFilter() first to reject facilities outside the scope.
 */
export function facilityCond(col: PgColumn, f: ReportFilters, scope: number[] | null, nullable = false): SQL | undefined {
  if (f.facilityId) return eq(col, f.facilityId);
  if (scope === null) return undefined;
  if (scope.length === 0) return nullable ? isNull(col) : sql`false`;
  return nullable ? or(inArray(col, scope), isNull(col)) : inArray(col, scope);
}

/** Facilities for the filter select, limited to the user's scope. */
export async function facilityOptions(scope: number[] | null) {
  const rows = await db.select({ id: facilities.id, code: facilities.code, name: facilities.name }).from(facilities).orderBy(asc(facilities.code));
  return scope === null ? rows : rows.filter((r) => scope.includes(r.id));
}

export async function facilityName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const [r] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, id));
  return r?.name ?? null;
}

/** EGP per unit for each currency, at today's stored rate (null when no rate is stored). */
export async function ratesFor(currencies: Iterable<string | null | undefined>): Promise<Map<string, number | null>> {
  const set = new Set<string>();
  for (const c of currencies) if (c) set.add(c);
  const out = new Map<string, number | null>();
  await Promise.all([...set].map(async (c) => { out.set(c, await rateToEgp(c)); }));
  return out;
}

export function missingRatesNote(missing: Iterable<string>): string | null {
  const m = [...new Set(missing)].sort();
  return m.length ? `No exchange rate stored for ${m.join(", ")}: those amounts are left out of the EGP totals.` : null;
}

export const EGP_NOTE = "EGP values use the latest stored exchange rate for each currency.";

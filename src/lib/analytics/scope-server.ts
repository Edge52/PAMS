import "server-only";
/**
 * Which hospitals an Analytics tab may read (wave 40). Same rule as the reports: an administrator or a user with all
 * hospitals sees every one, others only theirs. A hospital picked in the filters must be one of them (else the user
 * is sent to /forbidden). Always a concrete id list, so queries can use `inScope(col, ids)`.
 */
import { asc, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import { facilityScope, requireFacilityAccess, type CurrentUser } from "@/lib/auth/session";
import type { Filters } from "./core";

export async function analyticsScope(me: CurrentUser, filters: Pick<Filters, "facilityId">): Promise<number[]> {
  if (filters.facilityId) {
    await requireFacilityAccess(filters.facilityId, me);
    return [filters.facilityId];
  }
  const scope = await facilityScope(me);
  if (scope !== null) return scope;
  const rows = await db.select({ id: facilities.id }).from(facilities).orderBy(asc(facilities.id));
  return rows.map((r) => r.id);
}

/** WHERE condition: the column is one of these hospitals (false when there are none). */
export function inScope(col: PgColumn, ids: number[]): SQL {
  return ids.length ? inArray(col, ids) : sql`false`;
}

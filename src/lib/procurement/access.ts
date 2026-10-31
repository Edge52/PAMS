import "server-only";
/** Facility scoping helpers for procurement and BOQ list queries. */
import { inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { facilityScope, type CurrentUser } from "@/lib/auth/session";

/**
 * WHERE clause limiting rows to the facilities a user may see (null scope = everything). Records without a facility
 * are visible to everyone, matching requireFacilityAccess(null), which lets them through.
 */
export function scopeWhere(column: PgColumn, scope: number[] | null): SQL | undefined {
  if (scope == null) return undefined;
  if (scope.length === 0) return sql`${column} is null`;
  return sql`(${column} is null or ${inArray(column, scope)})`;
}

export async function scopeFor(me: CurrentUser, column: PgColumn): Promise<SQL | undefined> {
  return scopeWhere(column, await facilityScope(me));
}

import "server-only";
/**
 * Facility-scope helpers for the assets module. `scope` is what `facilityScope(me)` returns:
 * null = every facility, otherwise the ids the user may see (empty = none).
 */
import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, buildings, departments, floors, maintenanceEvents, rooms } from "@/db/schema";

export type Scope = number[] | null;

/** WHERE condition limiting `column` (a facility id column) to the scope; undefined when unrestricted. */
export function scopeWhere(column: PgColumn, scope: Scope): SQL | undefined {
  if (scope === null) return undefined;
  return scope.length ? inArray(column, scope) : sql`false`;
}

export function inScope(scope: Scope, facilityId: number | null | undefined): boolean {
  if (facilityId == null) return true;
  return scope === null || scope.includes(facilityId);
}

/** Drop a requested facility id the user may not see (so a URL can't widen a list). */
export function scopedFacilityId(scope: Scope, facilityId: number | null | undefined): number | undefined {
  return facilityId != null && inScope(scope, facilityId) ? facilityId : undefined;
}

export async function facilityOfAsset(assetId: number): Promise<number | null> {
  const [r] = await db.select({ f: assets.facilityId }).from(assets).where(eq(assets.id, assetId));
  return r?.f ?? null;
}

export async function facilityOfRoom(roomId: number): Promise<number | null> {
  const [r] = await db.select({ f: buildings.facilityId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(rooms.id, roomId));
  return r?.f ?? null;
}

export async function facilityOfFloor(floorId: number): Promise<number | null> {
  const [r] = await db.select({ f: buildings.facilityId }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.id, floorId));
  return r?.f ?? null;
}

export async function facilityOfDepartment(departmentId: number): Promise<number | null> {
  const [r] = await db.select({ f: departments.facilityId }).from(departments).where(eq(departments.id, departmentId));
  return r?.f ?? null;
}

export async function facilityOfEvent(eventId: number): Promise<number | null> {
  const [r] = await db.select({ f: assets.facilityId }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
    .where(eq(maintenanceEvents.id, eventId));
  return r?.f ?? null;
}

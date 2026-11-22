import "server-only";
/** Database side of clinical device calibration (wave 37). Rules are pure in ./calibration. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetCalibration, assets, calibrations, departments, deviceTypeCalibration, deviceTypes, rooms } from "@/db/schema";
import { scopeWhere, type Scope } from "./access";
import { calibrationInterval, calibrationState, COUNTED_STATUSES, type CalibrationState } from "./calibration";

type Tx = Pick<typeof db, "select" | "update" | "insert" | "execute">;

/** The latest calibration of a device, or null. */
export async function lastCalibration(assetId: number, x: Tx = db) {
  const [c] = await x.select().from(calibrations).where(eq(calibrations.assetId, assetId))
    .orderBy(desc(calibrations.calibratedOn), desc(calibrations.id)).limit(1);
  return c ?? null;
}

/** A failed calibration keeps this device out of service until a passing one is recorded. */
export async function calibrationHeld(assetId: number, x: Tx = db): Promise<boolean> {
  return (await lastCalibration(assetId, x))?.result === "FAIL";
}

/** The interval that applies to one device, and where it comes from. */
export async function intervalFor(assetId: number, deviceTypeId: number, x: Tx = db) {
  const [[own], [type]] = await Promise.all([
    x.select({ m: assetCalibration.intervalMonths, reason: assetCalibration.reason }).from(assetCalibration).where(eq(assetCalibration.assetId, assetId)),
    x.select({ m: deviceTypeCalibration.intervalMonths }).from(deviceTypeCalibration).where(eq(deviceTypeCalibration.deviceTypeId, deviceTypeId)),
  ]);
  return { ...calibrationInterval(own?.m, type?.m), own: own?.m ?? null, reason: own?.reason ?? null, typeMonths: type?.m ?? null };
}

export type CalibrationDevice = {
  id: number; tag: string; status: string; facilityId: number; typeName: string; typeCode: string;
  departmentId: number | null; departmentName: string | null; roomName: string | null;
  months: number; intervalSource: "device" | "type" | "default";
  last: { id: number; calibratedOn: string; result: string; nextDue: string | null; performedBy: string; certificateRef: string | null } | null;
  state: CalibrationState;
};

/**
 * Every device that needs calibration (its type requires it), in use, within the scope, with its latest
 * calibration and state. Test equipment is left out: its calibration is kept on the device (safety tests page).
 */
export async function calibrationDevices(scope: Scope, today: string, opts: { facilityId?: number; departmentId?: number; assetIds?: number[] } = {}): Promise<CalibrationDevice[]> {
  if (opts.assetIds && !opts.assetIds.length) return [];
  const rows = await db.select({
    id: assets.id, tag: assets.assetTag, status: assets.status, facilityId: assets.facilityId, deviceTypeId: assets.deviceTypeId,
    typeName: deviceTypes.name, typeCode: deviceTypes.code, departmentId: assets.departmentId, departmentName: departments.name, roomName: rooms.name,
    own: assetCalibration.intervalMonths, typeMonths: deviceTypeCalibration.intervalMonths,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .leftJoin(assetCalibration, eq(assetCalibration.assetId, assets.id))
    .leftJoin(deviceTypeCalibration, eq(deviceTypeCalibration.deviceTypeId, assets.deviceTypeId))
    .where(and(eq(deviceTypes.requiresCalibration, true), eq(assets.isTestEquipment, false), inArray(assets.status, [...COUNTED_STATUSES] as never[]),
      scopeWhere(assets.facilityId, scope), opts.facilityId ? eq(assets.facilityId, opts.facilityId) : undefined,
      opts.departmentId ? eq(assets.departmentId, opts.departmentId) : undefined, opts.assetIds ? inArray(assets.id, opts.assetIds) : undefined))
    .orderBy(assets.assetTag);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const last = await db.selectDistinctOn([calibrations.assetId], {
    assetId: calibrations.assetId, id: calibrations.id, calibratedOn: calibrations.calibratedOn, result: calibrations.result, nextDue: calibrations.nextDue,
    performedBy: calibrations.performedBy, certificateRef: calibrations.certificateRef,
  }).from(calibrations).where(ids.length > 2000 ? undefined : inArray(calibrations.assetId, ids))
    .orderBy(calibrations.assetId, desc(calibrations.calibratedOn), desc(calibrations.id));
  const byAsset = new Map(last.map((l) => [l.assetId, l]));
  return rows.map((r) => {
    const l = byAsset.get(r.id) ?? null;
    const iv = calibrationInterval(r.own, r.typeMonths);
    return {
      id: r.id, tag: r.tag, status: r.status, facilityId: r.facilityId, typeName: r.typeName, typeCode: r.typeCode,
      departmentId: r.departmentId, departmentName: r.departmentName, roomName: r.roomName, months: iv.months, intervalSource: iv.source,
      last: l ? { id: l.id, calibratedOn: l.calibratedOn, result: l.result, nextDue: l.nextDue, performedBy: l.performedBy, certificateRef: l.certificateRef } : null,
      state: calibrationState(l, today),
    };
  });
}

/** Number of calibrations recorded in the last 12 months within the scope. */
export async function calibrationsLastYear(scope: Scope): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(calibrations)
    .where(and(scopeWhere(calibrations.facilityId, scope), sql`${calibrations.calibratedOn} >= current_date - 365`));
  return Number(r?.n ?? 0);
}

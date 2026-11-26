import "server-only";
/** Database side of backups for critical devices (wave 40). Rules are pure in ./critical-backup. */
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, criticalBackups, departments, deviceTypes, facilities } from "@/db/schema";
import { scopeWhere, type Scope } from "@/lib/assets/access";
import type { Alert } from "@/lib/notifications/alert-rules";
import { backupAlertKey, backupStates, shortfalls, type BackupState } from "./critical-backup";

export type BackupRow = BackupState & { departmentName: string; typeName: string; typeCode: string; criticality: string | null; facilityName: string };

/** Every backup setting in the scope (or one hospital) with its counts today. */
export async function backupRows(scope: Scope, facilityId?: number): Promise<BackupRow[]> {
  const settings = await db.select({
    s: criticalBackups, departmentName: departments.name, typeName: deviceTypes.name, typeCode: deviceTypes.code, criticality: deviceTypes.criticality, facilityName: facilities.name,
  }).from(criticalBackups).innerJoin(departments, eq(departments.id, criticalBackups.departmentId)).innerJoin(deviceTypes, eq(deviceTypes.id, criticalBackups.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, criticalBackups.facilityId))
    .where(and(scopeWhere(criticalBackups.facilityId, scope), facilityId ? eq(criticalBackups.facilityId, facilityId) : undefined)).limit(2000);
  if (!settings.length) return [];
  const units = await db.select({ departmentId: assets.departmentId, deviceTypeId: assets.deviceTypeId, status: assets.status }).from(assets)
    .where(and(inArray(assets.departmentId, [...new Set(settings.map((x) => x.s.departmentId))]), inArray(assets.deviceTypeId, [...new Set(settings.map((x) => x.s.deviceTypeId))]), ne(assets.status, "DISPOSED")));
  const states = backupStates(settings.map((x) => x.s), units);
  return states.map((st, i) => ({ ...st, departmentName: settings[i].departmentName, typeName: settings[i].typeName, typeCode: settings[i].typeCode, criticality: settings[i].criticality ?? null, facilityName: settings[i].facilityName }));
}

/** Hourly alert run: the last working backup of a life-support or high criticality type has gone (biomedical, the hospital). */
export async function criticalBackupAlerts(): Promise<Alert[]> {
  const rows = shortfalls(await backupRows(null)).filter((r) => r.state === "none_left");
  return rows.map((r) => ({
    role: "BIOMEDICAL" as const, facilityId: r.facilityId,
    n: {
      kind: "critical_backup",
      title: `${r.departmentName}: no working backup ${r.typeName.toLowerCase()} left`,
      body: `${r.working} working of ${r.required} needed (${r.inUseCount} in use and ${r.backupCount} backup${r.backupCount === 1 ? "" : "s"}). Repair one, or lend or rent a unit.`,
      href: `/assets/critical-backup?facilityId=${r.facilityId}`,
      dedupeKey: backupAlertKey(r),
    },
  }));
}

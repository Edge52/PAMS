/**
 * Backups for critical devices (wave 40, GAHAR 2025 standards EFS.10): each department keeps enough working units of
 * a critical device type for the units in daily use plus the backups it set. Pure (tested).
 */

/** Statuses that count as a working unit: installed or in service. */
export const WORKING = new Set(["INSTALLED", "IN_SERVICE"]);
/** Criticality levels the shortfall list is for. */
export const CRITICAL_LEVELS = new Set(["LIFE_SUPPORT", "HIGH"]);

export type BackupSetting = { id: number; facilityId: number; departmentId: number; deviceTypeId: number; inUseCount: number; backupCount: number; notes?: string | null };
export type UnitRow = { departmentId: number | null; deviceTypeId: number; status: string };

export type BackupState = BackupSetting & {
  units: number; working: number; required: number; backupsLeft: number; short: number;
  /** "ok", "short" (fewer working than needed) or "none_left" (backups were required and none is working). */
  state: "ok" | "short" | "none_left";
};

/** Units and working units per setting, and where each stands. */
export function backupStates(settings: BackupSetting[], units: UnitRow[]): BackupState[] {
  const count = new Map<string, { units: number; working: number }>();
  for (const u of units) {
    if (u.departmentId == null || u.status === "DISPOSED") continue;
    const k = `${u.departmentId}:${u.deviceTypeId}`;
    const c = count.get(k) ?? { units: 0, working: 0 };
    c.units++;
    if (WORKING.has(u.status)) c.working++;
    count.set(k, c);
  }
  return settings.map((s) => {
    const c = count.get(`${s.departmentId}:${s.deviceTypeId}`) ?? { units: 0, working: 0 };
    const required = s.inUseCount + s.backupCount;
    const backupsLeft = Math.max(0, c.working - s.inUseCount);
    const short = Math.max(0, required - c.working);
    const state = s.backupCount > 0 && backupsLeft === 0 ? "none_left" : short > 0 ? "short" : "ok";
    return { ...s, units: c.units, working: c.working, required, backupsLeft, short, state };
  });
}

/** The shortfall list: settings for life-support or high criticality types with fewer working units than required. */
export function shortfalls<T extends BackupState & { criticality: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.short > 0 && r.criticality != null && CRITICAL_LEVELS.has(r.criticality))
    .sort((a, b) => Number(b.state === "none_left") - Number(a.state === "none_left") || b.short - a.short);
}

/**
 * Alert when the last working backup has gone: once per setting and day it starts (the key carries the number of
 * working units, so a further loss alerts again and a unit coming back resets it).
 */
export function backupAlertKey(s: Pick<BackupState, "id" | "working">): string {
  return `critical_backup:${s.id}:${s.working}`;
}

export function backupProblem(inUse: number | undefined, backups: number | undefined): string | null {
  if (inUse == null || backups == null) return "Enter the units in use and the backups needed.";
  if (inUse + backups === 0) return "Units in use and backups can't both be 0.";
  return null;
}

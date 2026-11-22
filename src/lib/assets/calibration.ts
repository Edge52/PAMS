/**
 * Calibration of clinical devices (wave 37): intervals, next due dates, where a device stands, the compliance
 * figure and the effect of a result on the device's status. Pure, safe on server and client.
 *
 * A device needs calibration when its device type says so (`device_types.requires_calibration`). The interval is the
 * device's own when set, else its type's, else 12 months. A failed calibration takes the device out of service, and
 * it stays out (work orders, the status form and maintenance can't put it back) until a passing one is recorded.
 */
import { addDays, addMonths } from "./dates";

export const CALIBRATION_RESULTS = ["PASS", "ADJUSTED", "FAIL"] as const;
export type CalibrationResult = (typeof CALIBRATION_RESULTS)[number];
export const CALIBRATION_RESULT_LABELS: Record<CalibrationResult, string> = {
  PASS: "Passed as found", ADJUSTED: "Adjusted, now in tolerance", FAIL: "Failed: out of tolerance",
};
export const CALIBRATION_RESULT_TONE = { PASS: "ok", ADJUSTED: "info", FAIL: "danger" } as const;

export const DEFAULT_CALIBRATION_MONTHS = 12;
/** "Due soon" is this many days ahead (same as safety tests). */
export const CALIBRATION_SOON_DAYS = 30;

/** The interval that applies: the device's own, else its type's, else 12 months. */
export function calibrationInterval(own: number | null | undefined, type: number | null | undefined): { months: number; source: "device" | "type" | "default" } {
  if (own && own > 0) return { months: own, source: "device" };
  if (type && type > 0) return { months: type, source: "type" };
  return { months: DEFAULT_CALIBRATION_MONTHS, source: "default" };
}

/** Next due date after a calibration: none after a failure (it must pass first). */
export function nextCalibrationDue(calibratedOn: string, months: number, result: CalibrationResult): string | null {
  if (result === "FAIL") return null;
  return addMonths(calibratedOn, months > 0 ? months : DEFAULT_CALIBRATION_MONTHS);
}

export type CalibrationState = "failed" | "overdue" | "soon" | "ok" | "never";
export const CALIBRATION_STATE_LABELS: Record<CalibrationState, string> = {
  failed: "Failed, out of service", overdue: "Overdue", soon: `Due within ${CALIBRATION_SOON_DAYS} days`, ok: "In date", never: "Never calibrated",
};
export const CALIBRATION_STATE_TONE = { failed: "danger", overdue: "danger", soon: "warn", ok: "ok", never: "neutral" } as const;

/** Where a device stands from its latest calibration (null = none on record). */
export function calibrationState(last: { result: string; nextDue: string | null } | null | undefined, today: string, soonDays = CALIBRATION_SOON_DAYS): CalibrationState {
  if (!last) return "never";
  if (last.result === "FAIL") return "failed";
  if (!last.nextDue) return "never";
  if (last.nextDue < today) return "overdue";
  return last.nextDue <= addDays(today, soonDays) ? "soon" : "ok";
}

/** Device statuses that count for compliance: in use or ready for use (not in store, not disposed). */
export const COUNTED_STATUSES = new Set(["INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "ON_LOAN"]);

/**
 * Calibration compliance: of the devices that need calibration and are in use, the share whose calibration is in
 * date today ("ok" or "soon"). Failed, overdue and never calibrated devices count against it. Null when none count.
 */
export function calibrationCompliance(states: CalibrationState[]): { counted: number; inDate: number; pct: number | null } {
  const inDate = states.filter((s) => s === "ok" || s === "soon").length;
  return { counted: states.length, inDate, pct: states.length ? Math.round((inDate / states.length) * 1000) / 10 : null };
}

export type DepartmentRow = { departmentId: number | null; departmentName: string | null; state: CalibrationState };
export type DepartmentSummary = { departmentId: number | null; name: string; total: number; ok: number; soon: number; overdue: number; failed: number; never: number; pct: number | null };

/** Counts per department, worst compliance first; devices without a department go under "No department". */
export function byDepartment(rows: DepartmentRow[]): DepartmentSummary[] {
  const m = new Map<string, DepartmentSummary>();
  for (const r of rows) {
    const k = String(r.departmentId ?? "none");
    const s = m.get(k) ?? { departmentId: r.departmentId, name: r.departmentName ?? "No department", total: 0, ok: 0, soon: 0, overdue: 0, failed: 0, never: 0, pct: null };
    s.total++; s[r.state]++;
    m.set(k, s);
  }
  const out = [...m.values()].map((s) => ({ ...s, pct: s.total ? Math.round(((s.ok + s.soon) / s.total) * 1000) / 10 : null }));
  return out.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.name.localeCompare(b.name));
}

/**
 * The device's status after a calibration is recorded, or null to leave it.
 *  - FAIL takes a device in use out of service (not one in store, on loan or disposed, nor one already out);
 *  - a pass after a failure puts it back to the status it had (IN_SERVICE if unknown), unless something else keeps
 *    it down: another open job with the device down, or a disposal waiting for approval or approved.
 */
export function statusAfterCalibration(result: CalibrationResult, o: {
  assetStatus: string; previousFailed: boolean; statusBefore?: string | null; otherDownJobs?: number; disposalPending?: boolean;
}): string | null {
  if (["DISPOSED", "IN_STOCK", "ON_LOAN"].includes(o.assetStatus)) return null;
  if (result === "FAIL") return o.assetStatus === "OUT_OF_SERVICE" ? null : "OUT_OF_SERVICE";
  if (!o.previousFailed || o.assetStatus !== "OUT_OF_SERVICE") return null;
  if ((o.otherDownJobs ?? 0) > 0 || o.disposalPending) return null;
  const back = o.statusBefore && !["OUT_OF_SERVICE", "UNDER_MAINTENANCE", "DISPOSED", "IN_STOCK", "ON_LOAN"].includes(o.statusBefore) ? o.statusBefore : "IN_SERVICE";
  return back;
}

/** Why the device can't be put to this status while a failed calibration holds it, or null. */
export function calibrationHoldProblem(held: boolean, nextStatus: string | null | undefined): string | null {
  if (!held || (nextStatus !== "IN_SERVICE" && nextStatus !== "INSTALLED")) return null;
  return "This device failed its last calibration, so it stays out of service. Record a passing calibration first.";
}

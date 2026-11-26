/** Pure counting behind the wave 40 reports (calibration, electrical safety, recalls, user training). Tested. */
import { daysBetween } from "../assets/dates";

/** Rows of one or more devices, sorted by device then date: each gets the due date the record before it set. */
export function withPreviousDue<T extends { assetId: number; nextDue: string | null }>(rows: T[]): (T & { prevDue: string | null })[] {
  let last: T | null = null;
  return rows.map((r) => {
    const prevDue = last && last.assetId === r.assetId ? last.nextDue : null;
    last = r;
    return { ...r, prevDue };
  });
}

export type SafetyTally = { tests: number; passed: number; failed: number; devices: number; overdue: number; failedNow: number; inDate: number };
export const emptySafety = (): SafetyTally => ({ tests: 0, passed: 0, failed: 0, devices: 0, overdue: 0, failedNow: 0, inDate: 0 });

/**
 * Where a device stands from its latest test: failed (last test failed), overdue (next due before today) or in date.
 */
export function latestSafetyState(last: { result: string; nextDue: string | null }, today: string): "failed" | "overdue" | "in_date" {
  if (last.result === "FAIL") return "failed";
  if (last.nextDue && last.nextDue < today) return "overdue";
  return "in_date";
}

/** Days from issue (or the day it was recorded) to closing; null while open. */
export function daysToClose(r: { issuedDate: string | null; createdOn: string; closedOn: string | null }): number | null {
  if (!r.closedOn) return null;
  return Math.max(0, daysBetween(r.issuedDate ?? r.createdOn, r.closedOn));
}

/** Recall progress on devices: pending, actioned, not affected, and the share done (actioned or not affected). */
export function recallDeviceTally(rows: { status: string }[]) {
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const actioned = rows.filter((r) => r.status === "ACTIONED").length;
  const notAffected = rows.filter((r) => r.status === "NOT_AFFECTED").length;
  const total = rows.length;
  return { total, pending, actioned, notAffected, donePct: total ? Math.round(((actioned + notAffected) / total) * 1000) / 10 : null };
}

/**
 * User training coverage: of the (department, device type) pairs with devices in use, the share with at least one
 * person whose training is current. `trained` holds "dept:type" keys with a current trainee.
 */
export function trainingCoverage(pairs: string[], trained: Set<string>): { pairs: number; covered: number; pct: number | null } {
  const uniq = [...new Set(pairs)];
  const covered = uniq.filter((p) => trained.has(p)).length;
  return { pairs: uniq.length, covered, pct: uniq.length ? Math.round((covered / uniq.length) * 1000) / 10 : null };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Planned maintenance visits in My jobs (wave 43). Pure (my-visits.test.ts).
 *
 * A visit (scheduled or overdue) that has no work order yet shows in My jobs when it is due within a week or overdue:
 *  - to the technician who did the device's last planned job (its usual technician), while they can still work in
 *    that hospital;
 *  - otherwise to the whole team: everyone with maintenance rights in that hospital.
 * "Start" raises the job for that person and starts it, like "Create work orders" on the schedule.
 */

/** Days ahead a visit appears. */
export const VISIT_LOOKAHEAD_DAYS = 7;
export const MAX_VISITS = 100;

export type VisitCandidate = {
  status: string; scheduledDate: string | null; hasJob: boolean; assetStatus: string; facilityId: number;
  /** The usual technician of the device (last planned job), or null. */
  usualTechId: number | null;
};

export type VisitFor = "mine" | "team";

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Whether a visit shows in this person's My jobs, and why. `canWorkIn(userId, facilityId)` says whether someone may
 * still take jobs in that hospital; `scope` is the person's hospitals (null = all).
 */
export function visitFor(v: VisitCandidate, me: { id: number; scope: readonly number[] | null }, today: string,
  canWorkIn: (userId: number, facilityId: number) => boolean): VisitFor | null {
  if (v.hasJob || !["SCHEDULED", "OVERDUE"].includes(v.status) || v.assetStatus === "DISPOSED" || !v.scheduledDate) return null;
  if (v.scheduledDate > addDays(today, VISIT_LOOKAHEAD_DAYS)) return null;
  if (me.scope !== null && !me.scope.includes(v.facilityId)) return null;
  if (!canWorkIn(me.id, v.facilityId)) return null;
  if (v.usualTechId != null && canWorkIn(v.usualTechId, v.facilityId)) return v.usualTechId === me.id ? "mine" : null;
  return "team";
}

export const isOverdue = (v: { status: string; scheduledDate: string | null }, today: string) => v.status === "OVERDUE" || (v.scheduledDate != null && v.scheduledDate < today);

/** Overdue first, then by date. */
export function sortVisits<T extends { scheduledDate: string | null; overdue: boolean }>(xs: T[]): T[] {
  return xs.toSorted((a, b) => Number(b.overdue) - Number(a.overdue) || (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? ""));
}

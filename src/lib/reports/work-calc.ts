/** Work order timing for the work orders report (wave 26). Pure. */

export const hoursBetween = (a: Date | null, b: Date | null): number | null => (a && b ? Math.max(0, (b.getTime() - a.getTime()) / 3_600_000) : null);

export function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export type WoTiming = { priority: string; reportedAt: Date; dueAt: Date | null; respondedAt: Date | null; doneAt: Date | null; cancelled: boolean };

/** Per job: was it answered by the target time? null when there was no target, or it isn't answered and isn't late yet. */
export function respondedInTime(w: WoTiming, now: Date): boolean | null {
  if (!w.dueAt || w.cancelled) return null;
  if (w.respondedAt) return w.respondedAt <= w.dueAt;
  return now > w.dueAt ? false : null;
}

export type WoGroup = { jobs: number; open: number; inTime: number; judged: number; medianResponseH: number | null; medianRepairH: number | null };

/** Tally a set of jobs: how many, still open, answered in time (of those that can be judged), median times in hours. */
export function tallyJobs(list: WoTiming[], now: Date): WoGroup {
  const live = list.filter((w) => !w.cancelled);
  const judged = live.map((w) => respondedInTime(w, now)).filter((x): x is boolean => x != null);
  return {
    jobs: live.length,
    open: live.filter((w) => !w.doneAt).length,
    inTime: judged.filter(Boolean).length,
    judged: judged.length,
    medianResponseH: median(live.map((w) => hoursBetween(w.reportedAt, w.respondedAt))),
    medianRepairH: median(live.map((w) => hoursBetween(w.reportedAt, w.doneAt))),
  };
}

/** "3 h", "2.5 days" — hours below two days, else days. */
export function hoursText(h: number | null): string | null {
  if (h == null) return null;
  if (h < 48) return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

import { describe, expect, it } from "vitest";
import { hoursBetween, hoursText, median, respondedInTime, tallyJobs, type WoTiming } from "./work-calc";

const t = (h: number) => new Date(Date.UTC(2026, 10, 1) + h * 3_600_000);
const job = (o: Partial<WoTiming>): WoTiming => ({ priority: "NORMAL", reportedAt: t(0), dueAt: t(24), respondedAt: null, doneAt: null, cancelled: false, ...o });

describe("work order timing (wave 26)", () => {
  it("measures hours and medians", () => {
    expect(hoursBetween(t(0), t(5))).toBe(5);
    expect(hoursBetween(t(0), null)).toBeNull();
    expect(median([3, null, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([null])).toBeNull();
  });
  it("judges the response against the target", () => {
    const now = t(100);
    expect(respondedInTime(job({ respondedAt: t(10) }), now)).toBe(true);
    expect(respondedInTime(job({ respondedAt: t(30) }), now)).toBe(false);
    expect(respondedInTime(job({}), now)).toBe(false);
    expect(respondedInTime(job({}), t(12))).toBeNull();
    expect(respondedInTime(job({ dueAt: null, respondedAt: t(1) }), now)).toBeNull();
    expect(respondedInTime(job({ cancelled: true }), now)).toBeNull();
  });
  it("tallies a group of jobs, leaving cancelled ones out", () => {
    const g = tallyJobs([
      job({ respondedAt: t(2), doneAt: t(10) }), job({ respondedAt: t(30), doneAt: t(50) }), job({}), job({ cancelled: true, respondedAt: t(1) }),
    ], t(100));
    expect(g).toEqual({ jobs: 3, open: 1, inTime: 1, judged: 3, medianResponseH: 16, medianRepairH: 30 });
  });
  it("writes durations in words", () => {
    expect(hoursText(3.25)).toBe("3.3 h");
    expect(hoursText(30)).toBe("30 h");
    expect(hoursText(60)).toBe("2.5 days");
    expect(hoursText(null)).toBeNull();
  });
});

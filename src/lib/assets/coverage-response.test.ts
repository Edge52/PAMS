import { describe, expect, it } from "vitest";
import { coveredHoursBetween, coveredIntervals, type Coverage } from "./coverage";
import { contractStatement, type ContractJob } from "./planning";

// Sunday–Thursday 08:00–16:00 Cairo time; in late November Cairo is UTC+2, so 06:00–14:00 UTC.
const cov: Coverage = { allHours: false, days: [0, 1, 2, 3, 4], fromTime: "08:00", toTime: "16:00", excludeHolidays: true };
const d = (s: string) => new Date(s);
const from = d("2026-11-01T00:00:00Z"), to = d("2026-12-01T00:00:00Z");
const clock = coveredIntervals(cov, [], d("2026-10-25T00:00:00Z"), to);
const terms = { responseHours: 4, repairHours: 8, uptimePct: null, penaltyPerLateHour: 100, penaltyPerUptimePoint: null, penaltyCapPct: null, value: null, startDate: "2026-01-01", endDate: "2026-12-31" };
const job = (over: Partial<ContractJob>): ContractJob => ({ id: 1, number: "WO-1", tag: "A", reportedAt: d("2026-11-19T13:00:00Z"), startedAt: null, completedAt: null,
  deviceDown: false, downtimeStart: null, downtimeEnd: null, ...over });

describe("response and repair in covered hours (wave 41)", () => {
  it("counts only covered hours between two instants", () => {
    // Thursday 15:00 Cairo → Sunday 09:00 Cairo: 1 h on Thursday, 1 h on Sunday.
    expect(coveredHoursBetween(clock, d("2026-11-19T13:00:00Z"), d("2026-11-22T07:00:00Z"))).toBeCloseTo(2);
    expect(coveredHoursBetween(clock, d("2026-11-22T07:00:00Z"), d("2026-11-22T07:00:00Z"))).toBe(0);
  });
  it("a weekend job is not late in covered hours, though it is on the clock", () => {
    const j = job({ startedAt: d("2026-11-22T07:00:00Z"), completedAt: d("2026-11-22T10:00:00Z") });
    const inCovered = contractStatement(terms, [j], 1, from, to, null, clock).jobs[0];
    expect(inCovered.responseH).toBeCloseTo(2);
    expect(inCovered.repairH).toBeCloseTo(5);
    expect(inCovered.lateH).toBe(0);
    expect(inCovered.responseClockH).toBeCloseTo(66);
    expect(inCovered.inCoveredHours).toBe(true);
    const onClock = contractStatement(terms, [j], 1, from, to).jobs[0];
    expect(onClock.responseH).toBeCloseTo(66);
    expect(onClock.lateH).toBeCloseTo(62); // response 66 − 4 beats repair 69 − 8
  });
  it("an overnight job counts from the next morning", () => {
    // Monday 17:00 Cairo (after hours) → Tuesday 08:30 started, 10:00 back in use.
    const j = job({ reportedAt: d("2026-11-23T15:00:00Z"), startedAt: d("2026-11-24T06:30:00Z"), completedAt: d("2026-11-24T08:00:00Z") });
    const r = contractStatement(terms, [j], 1, from, to, null, clock).jobs[0];
    expect(r.responseH).toBeCloseTo(0.5);
    expect(r.repairH).toBeCloseTo(2);
    expect(r.lateH).toBe(0);
  });
  it("an open job counts covered hours up to the end of the period", () => {
    const j = job({ reportedAt: d("2026-11-26T13:00:00Z") }); // Thursday 15:00 Cairo, still open
    const r = contractStatement(terms, [j], 1, from, d("2026-11-29T14:00:00Z"), null, clock).jobs[0];
    // Thursday 1 h + Sunday 8 h = 9 h: 5 h past the 4 h response target, 1 h past the 8 h repair target.
    expect(r.open).toBe(true);
    expect(r.lateH).toBeCloseTo(5);
  });
});

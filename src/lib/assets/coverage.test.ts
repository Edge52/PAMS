import { describe, expect, it } from "vitest";
import { coverageLabel, coverageProblem, coveredDowntimeMs, coveredIntervals, DEFAULT_COVERAGE, intersectIntervals, localDate, shiftHours, totalMs, type Coverage } from "./coverage";
import { downtimeMs } from "./downtime";
import { contractStatement } from "./planning";
import { EGYPT_HOLIDAYS_2026_2027 } from "../../../scripts/seed/demo-holidays";

const H = 3_600_000;
const d = (s: string) => new Date(s);
const work: Coverage = DEFAULT_COVERAGE; // Sun–Thu 08:00–20:00, holidays off

describe("covered intervals", () => {
  it("is the whole window round the clock or without coverage", () => {
    const f = d("2026-11-01T00:00:00Z"), t = d("2026-11-08T00:00:00Z");
    expect(coveredIntervals(null, [], f, t)).toEqual([[f.getTime(), t.getTime()]]);
    expect(coveredIntervals({ ...work, allHours: true }, [], f, t)).toEqual([[f.getTime(), t.getTime()]]);
  });

  it("builds Sun–Thu 08:00–20:00 in Cairo winter time (UTC+2)", () => {
    // Week of Sun 1 Nov 2026 to Sat 7 Nov (local). Cairo is UTC+2 in November.
    const f = d("2026-10-31T22:00:00Z"), t = d("2026-11-07T22:00:00Z");
    const iv = coveredIntervals(work, [], f, t);
    expect(iv).toHaveLength(5);
    expect(new Date(iv[0][0]).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    expect(new Date(iv[0][1]).toISOString()).toBe("2026-11-01T18:00:00.000Z");
    expect(totalMs(iv) / H).toBe(60);
  });

  it("follows Egyptian summer time (UTC+3) without a fixed offset", () => {
    // Sunday 5 July 2026: Cairo is on summer time, so 08:00 local is 05:00 UTC.
    const iv = coveredIntervals(work, [], d("2026-07-05T00:00:00Z"), d("2026-07-06T00:00:00Z"));
    expect(new Date(iv[0][0]).toISOString()).toBe("2026-07-05T05:00:00.000Z");
    expect(totalMs(iv) / H).toBe(12);
  });

  it("drops weekends and public holidays", () => {
    // Thu 23 Jul 2026 is Revolution Day; Fri and Sat are not covered.
    const iv = coveredIntervals(work, ["2026-07-23"], d("2026-07-22T21:00:00Z"), d("2026-07-25T21:00:00Z"));
    expect(iv).toEqual([]);
    const noHol = coveredIntervals({ ...work, excludeHolidays: false }, ["2026-07-23"], d("2026-07-22T21:00:00Z"), d("2026-07-25T21:00:00Z"));
    expect(totalMs(noHol) / H).toBe(12);
  });

  it("handles overnight shifts, including one started the day before the window", () => {
    const night: Coverage = { allHours: false, days: [0, 1, 2, 3, 4, 5, 6], fromTime: "20:00", toTime: "08:00", excludeHolidays: false };
    // Window: Mon 2 Nov 2026 00:00 to 24:00 local. Sunday's shift covers 00:00–08:00, Monday's 20:00–24:00.
    const iv = coveredIntervals(night, [], d("2026-11-01T22:00:00Z"), d("2026-11-02T22:00:00Z"));
    expect(iv.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()])).toEqual([
      ["2026-11-01T22:00:00.000Z", "2026-11-02T06:00:00.000Z"], ["2026-11-02T18:00:00.000Z", "2026-11-02T22:00:00.000Z"],
    ]);
    expect(shiftHours(night)).toBe(12);
  });

  it("treats 24:00 as midnight and equal times as a full day", () => {
    expect(shiftHours({ fromTime: "08:00", toTime: "24:00" })).toBe(16);
    expect(shiftHours({ fromTime: "08:00", toTime: "08:00" })).toBe(24);
    const iv = coveredIntervals({ ...work, days: [0], toTime: "24:00" }, [], d("2026-11-01T00:00:00Z"), d("2026-11-03T00:00:00Z"));
    expect(totalMs(iv) / H).toBe(16);
  });

  it("checks the form", () => {
    expect(coverageProblem(work)).toBeNull();
    expect(coverageProblem({ ...work, days: [] })).toMatch(/at least one/);
    expect(coverageProblem({ ...work, fromTime: "8:00" })).toMatch(/start time/);
    expect(coverageProblem({ ...work, toTime: "24:30" })).toMatch(/end time/);
  });

  it("labels the hours", () => {
    expect(coverageLabel(work)).toBe("Sun–Thu 08:00–20:00, not on public holidays");
    expect(coverageLabel({ ...work, days: [0, 2], excludeHolidays: false })).toBe("Sun, Tue 08:00–20:00");
    expect(coverageLabel(null)).toBe("Round the clock (24/7)");
  });

  it("gives the local date in Cairo", () => {
    expect(localDate(d("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
  });
});

describe("downtime inside covered hours", () => {
  it("intersects sorted lists", () => {
    expect(intersectIntervals([[0, 10], [20, 30]], [[5, 25]])).toEqual([[5, 10], [20, 25]]);
    expect(intersectIntervals([[0, 10]], [])).toEqual([]);
  });

  it("counts a night outage only in the covered hours, and overlaps once", () => {
    // Down from Sun 1 Nov 18:00 to Mon 2 Nov 10:00 local, reported twice (overlapping jobs).
    const f = d("2026-10-31T22:00:00Z"), t = d("2026-11-07T22:00:00Z");
    const cov = coveredIntervals(work, [], f, t);
    const periods = [{ start: d("2026-11-01T16:00:00Z"), end: d("2026-11-02T08:00:00Z") }, { start: d("2026-11-01T20:00:00Z"), end: d("2026-11-02T07:00:00Z") }];
    // Sunday 18:00–20:00 (2 h) + Monday 08:00–10:00 (2 h).
    expect(coveredDowntimeMs(periods, cov, f, t) / H).toBe(4);
    expect(downtimeMs(periods, f, t) / H).toBe(16);
  });

  it("ignores a weekend outage and runs an open one to the end", () => {
    const f = d("2026-10-31T22:00:00Z"), t = d("2026-11-07T22:00:00Z");
    const cov = coveredIntervals(work, [], f, t);
    expect(coveredDowntimeMs([{ start: d("2026-11-05T19:00:00Z"), end: d("2026-11-07T20:00:00Z") }], cov, f, t)).toBe(0); // Thu 21:00 to Sat
    expect(coveredDowntimeMs([{ start: d("2026-11-05T16:00:00Z"), end: null }], cov, f, t) / H).toBe(2); // Thu 18:00 → 20:00
  });

  it("feeds the contract statement; no coverage keeps the 24/7 figures", () => {
    const terms = { responseHours: 4, repairHours: 24, uptimePct: 95, penaltyPerLateHour: 0, penaltyPerUptimePoint: 100, penaltyCapPct: null, value: null, startDate: "2026-01-01", endDate: "2026-12-31" };
    const f = d("2026-10-31T22:00:00Z"), t = d("2026-11-07T22:00:00Z");
    const job = { id: 1, number: "WO-1", tag: "MR1", reportedAt: d("2026-11-01T16:00:00Z"), startedAt: d("2026-11-01T17:00:00Z"), completedAt: d("2026-11-02T08:00:00Z"),
      deviceDown: true, downtimeStart: d("2026-11-01T16:00:00Z"), downtimeEnd: d("2026-11-02T08:00:00Z") };
    const plain = contractStatement(terms, [job], 1, f, t);
    expect(contractStatement(terms, [job], 1, f, t, null)).toEqual(plain);
    expect(plain.periodHours).toBe(168);
    expect(plain.downtimeH).toBe(16);
    const cov = contractStatement(terms, [job], 1, f, t, coveredIntervals(work, [], f, t));
    expect(cov.periodHours).toBe(60);
    expect(cov.downtimeH).toBe(4);
    expect(cov.uptimePct!).toBeCloseTo(100 * (1 - 4 / 60), 6);
    expect(cov.jobs[0].repairH).toBe(16); // repair stays in clock hours
  });
});

describe("demo holidays list (seed data)", () => {
  it("has unique, ordered dates in 2026–2027", () => {
    const days = EGYPT_HOLIDAYS_2026_2027.map((h) => h.day);
    expect(new Set(days).size).toBe(days.length);
    expect([...days].sort()).toEqual(days);
    expect(days.every((x) => /^202[67]-\d{2}-\d{2}$/.test(x))).toBe(true);
    expect(EGYPT_HOLIDAYS_2026_2027.filter((h) => h.name === "Eid al-Fitr").every((h) => h.approximate)).toBe(true);
  });
});

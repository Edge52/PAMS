import { describe, expect, it } from "vitest";
import { contractStatement, plannedYear, tco, usage } from "./planning";

const d = (s: string) => new Date(s);
describe("contract statement", () => {
  const terms = { responseHours: 4, repairHours: 48, uptimePct: 97, penaltyPerLateHour: 100, penaltyPerUptimePoint: 1000, penaltyCapPct: 10, value: 1_200_000, startDate: "2026-01-01", endDate: "2026-12-31" };
  const from = d("2026-10-01T00:00:00Z"), to = d("2026-11-01T00:00:00Z");
  it("finds late jobs, uptime short and penalties", () => {
    const s = contractStatement(terms, [
      { id: 1, number: "WO-1", tag: "CT1", reportedAt: d("2026-10-02T08:00:00Z"), startedAt: d("2026-10-02T14:00:00Z"), completedAt: d("2026-10-03T08:00:00Z"), deviceDown: true, downtimeStart: d("2026-10-02T08:00:00Z"), downtimeEnd: d("2026-10-03T08:00:00Z") },
      { id: 2, number: "WO-2", tag: "CT1", reportedAt: d("2026-10-20T00:00:00Z"), startedAt: d("2026-10-20T02:00:00Z"), completedAt: null, deviceDown: true, downtimeStart: d("2026-10-20T00:00:00Z"), downtimeEnd: null },
    ], 1, from, to);
    expect(s.jobs[0].responseH).toBe(6);
    expect(s.jobs[0].lateH).toBe(2); // response 2 h over; repair 24 h within 48
    expect(s.jobs[1].lateH).toBe(12 * 24 - 48); // open 12 days at the end of the month
    expect(s.downtimeH).toBe(24 + 12 * 24);
    expect(s.uptimePct!).toBeCloseTo(100 * (1 - 312 / 744), 5);
    expect(s.capped).toBe(true); // cap is 10 % of a month's share of 1.2 M ≈ 10,190
    expect(s.penalty).toBeCloseTo(s.cap!, 5);
  });
  it("counts one outage once when two jobs cover it (audit A1)", () => {
    // A 2-day MRI outage logged as two jobs: 48 h down, not 96 h.
    const mri = { tag: "MRI1", reportedAt: d("2026-10-10T00:00:00Z"), startedAt: d("2026-10-10T01:00:00Z"), completedAt: d("2026-10-12T00:00:00Z"), deviceDown: true,
      downtimeStart: d("2026-10-10T00:00:00Z"), downtimeEnd: d("2026-10-12T00:00:00Z") };
    const t95 = { ...terms, responseHours: null, repairHours: null, uptimePct: 95, penaltyCapPct: null };
    const s = contractStatement(t95, [{ ...mri, id: 1, number: "WO-1" }, { ...mri, id: 2, number: "WO-2", reportedAt: d("2026-10-10T06:00:00Z") }], 1, from, to);
    expect(s.downtimeH).toBe(48);
    expect(s.uptimePct!).toBeCloseTo(93.5, 1);
    expect(Math.round(s.penalty)).toBe(1452); // was 7,903 with the outage counted twice
  });
  it("keeps separate devices' outages apart", () => {
    const job = (id: number, tag: string) => ({ id, number: `WO-${id}`, tag, reportedAt: d("2026-10-10T00:00:00Z"), startedAt: null, completedAt: d("2026-10-11T00:00:00Z"),
      deviceDown: true, downtimeStart: d("2026-10-10T00:00:00Z"), downtimeEnd: d("2026-10-11T00:00:00Z") });
    expect(contractStatement(terms, [job(1, "CT1"), job(2, "CT2")], 2, from, to).downtimeH).toBe(48);
  });
  it("has no penalty without terms", () => {
    const s = contractStatement({ ...terms, responseHours: null, repairHours: null, uptimePct: null, penaltyCapPct: null }, [], 2, from, to);
    expect(s.penalty).toBe(0); expect(s.uptimePct).toBe(100);
  });
});

describe("utilisation", () => {
  it("compares exams with capacity and estimates lost exams", () => {
    const u = usage({ exams: 1100, scheduledHours: 365, downtimeH: 73, capacityPerYear: 12000, months: 1 });
    expect(u.utilisation).toBeCloseTo(1.1);
    expect(u.perUptimeHour!).toBeCloseTo(1100 / (365 - 36.5));
    expect(u.lostExams).toBe(Math.round(36.5 * (1100 / 328.5)));
    expect(usage({ exams: 0, scheduledHours: null, downtimeH: 0, capacityPerYear: null, months: 1 }).utilisation).toBeNull();
  });
});

describe("capital plan year", () => {
  it("places devices by score, life and end of support", () => {
    expect(plannedYear({ band: "REPLACE", installDate: "2010-01-01", lifeYears: 10, endOfSupport: null }, 2026).year).toBe(2026);
    expect(plannedYear({ band: "PLAN", installDate: "2018-01-01", lifeYears: 10, endOfSupport: null }, 2026).year).toBe(2028);
    expect(plannedYear({ band: "KEEP", installDate: "2024-01-01", lifeYears: 8, endOfSupport: "2029-06-30" }, 2026)).toEqual({ year: 2029, why: "Maker support ends" });
    expect(plannedYear({ band: "KEEP", installDate: null, lifeYears: null, endOfSupport: null }, 2026).year).toBeNull();
  });
});

describe("TCO", () => {
  it("adds service after warranty, running costs and downtime", () => {
    const t = tco({ capex: 1000, years: 10, warrantyMonths: 24, serviceAnnual: 100, consumablesAnnual: 10, energyAnnual: 20, otherAnnual: null, uptimePct: 98, downtimeCostPerDay: 5 });
    expect(t.service).toBe(800);
    expect(t.running).toBe(300);
    expect(t.downtime).toBeCloseTo(0.02 * 365 * 10 * 5);
    expect(t.total).toBeCloseTo(1000 + 800 + 300 + 365);
    expect(t.missing).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { costOfOwnership, deviceKpis, replacementScore, type KpiJob } from "./lifecycle-kpis";

const t = (s: string) => new Date(s);
const now = t("2026-10-31T00:00:00Z");
const job = (o: Partial<KpiJob>): KpiJob => ({ type: "CORRECTIVE", status: "CLOSED", reportedAt: t("2026-06-01T00:00:00Z"), completedAt: null, downtimeStart: null, downtimeEnd: null, ...o });

describe("device KPIs", () => {
  it("is 100 % up with no jobs", () => {
    expect(deviceKpis([], t("2020-01-01"), now)).toMatchObject({ uptimePct: 100, downtimeHours: 0, failures: 0, mtbfDays: null, mttrHours: null, windowDays: 365 });
  });
  it("counts downtime inside the window only, and open downtime up to now", () => {
    const k = deviceKpis([
      job({ downtimeStart: t("2025-10-30T00:00:00Z"), downtimeEnd: t("2025-11-02T00:00:00Z") }), // 1 day inside (window starts 31 Oct 2025)
      job({ downtimeStart: t("2026-10-30T00:00:00Z"), status: "IN_PROGRESS" }),                  // 1 day, still down
      job({ downtimeStart: t("2026-05-01T00:00:00Z"), downtimeEnd: t("2026-05-10T00:00:00Z"), status: "CANCELLED" }),
    ], t("2019-01-01"), now);
    expect(k.downtimeHours).toBe(72);
    expect(k.uptimePct).toBeCloseTo(99.2, 1);
  });
  it("uses the install date when the device is newer than the window", () => {
    expect(deviceKpis([], t("2026-09-01T00:00:00Z"), now).windowDays).toBe(60);
  });
  it("computes failures, MTBF and MTTR from corrective jobs", () => {
    const k = deviceKpis([
      job({ reportedAt: t("2026-03-01T00:00:00Z"), completedAt: t("2026-03-01T10:00:00Z") }),
      job({ reportedAt: t("2026-07-01T00:00:00Z"), completedAt: t("2026-07-02T06:00:00Z") }),
      job({ type: "PPM", reportedAt: t("2026-08-01T00:00:00Z"), completedAt: t("2026-08-01T02:00:00Z") }),
      job({ reportedAt: t("2024-01-01T00:00:00Z"), completedAt: t("2024-01-02T00:00:00Z") }),
    ], t("2018-01-01"), now);
    expect(k.failures).toBe(2);
    expect(k.mttrHours).toBe(20);
    expect(k.mtbfDays).toBe(182.5);
  });
  it("totals cost of ownership", () => {
    expect(costOfOwnership(100000, 15000, 5000)).toEqual({ total: 120000, maintenancePct: 20 });
    expect(costOfOwnership(null, 300, 0)).toEqual({ total: 300, maintenancePct: null });
  });
});

describe("replacement score", () => {
  const base = { lifeUsedPct: 40, repairCostRatio: 0.02, failures12m: 0, downtimeHours12m: 0, criticality: "MEDIUM", condition: "GOOD", openRecall: false };
  it("keeps a young, reliable device", () => {
    expect(replacementScore(base)).toMatchObject({ band: "KEEP", reasons: [] });
  });
  it("flags an old, failing, life-support device for replacement with reasons", () => {
    const r = replacementScore({ ...base, lifeUsedPct: 115, repairCostRatio: 0.6, failures12m: 3, downtimeHours12m: 400, criticality: "LIFE_SUPPORT", condition: "POOR" });
    expect(r.band).toBe("REPLACE");
    expect(r.score).toBe(95); // 35 age + 20 repairs + 15 failures + 10 downtime + 10 life support + 5 poor
    expect(r.reasons).toEqual([
      "Past its expected life (115 % used)", "Repairs cost 60 % of its price in 3 years", "3 failures in 12 months", "Out of use 17 days in 12 months", "Poor condition",
    ]);
  });
  it("puts a device near end of life into planning", () => {
    const r = replacementScore({ ...base, lifeUsedPct: 90, criticality: "HIGH", failures12m: 1 });
    expect(r.band).toBe("PLAN");
    expect(r.reasons).toEqual(["Near the end of its life (90 % used)"]);
  });
  it("handles unknown age and cost", () => {
    expect(replacementScore({ ...base, lifeUsedPct: null, repairCostRatio: null, openRecall: true }).reasons).toEqual(["Open recall"]);
  });
});

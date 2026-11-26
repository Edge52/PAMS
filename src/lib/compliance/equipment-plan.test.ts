import { describe, expect, it } from "vitest";
import { currentPlan, defaultKpis, kpiMet, kpisFromForm, kpiSnapshot, kpiText, PLAN_KPIS } from "./equipment-plan";

describe("plan KPIs", () => {
  it("defaults to every KPI with its target", () => {
    expect(defaultKpis().map((k) => k.key)).toEqual(PLAN_KPIS.map((k) => k.key));
  });
  it("reads ticked KPIs and targets from the form", () => {
    const f: Record<string, string> = { kpi_ppm_on_time: "on", target_ppm_on_time: "92.55", kpi_incidents: "on", target_incidents: "" };
    const r = kpisFromForm((n) => f[n]);
    expect("kpis" in r && r.kpis).toEqual([
      { key: "ppm_on_time", label: "PPM done on time", target: 92.6, unit: "%" },
      { key: "incidents", label: "Device incidents with harm", target: 0, unit: "count" },
    ]);
  });
  it("refuses bad targets and an empty list", () => {
    expect(kpisFromForm((n) => ({ kpi_uptime: "on", target_uptime: "120" } as Record<string, string>)[n])).toMatchObject({ field: "target_uptime" });
    expect(kpisFromForm(() => null)).toMatchObject({ field: "kpis" });
  });
  it("judges higher-is-better and lower-is-better", () => {
    expect(kpiMet("ppm_on_time", 91, 90)).toBe(true);
    expect(kpiMet("ppm_on_time", 89, 90)).toBe(false);
    expect(kpiMet("incidents", 0, 0)).toBe(true);
    expect(kpiMet("incidents", 2, 0)).toBe(false);
    expect(kpiMet("uptime", null, 95)).toBeNull();
  });
  it("snapshots values with the result", () => {
    const s = kpiSnapshot(defaultKpis().slice(0, 2), { ppm_on_time: 93.456, calibration_on_time: null });
    expect(s[0]).toMatchObject({ value: 93.5, met: true });
    expect(s[1]).toMatchObject({ value: null, met: null });
    expect(kpiText(s[0].value, "%")).toBe("93.5 %");
    expect(kpiText(null, "count")).toBe("No figure");
  });
  it("the plan that counts is the latest approved version of the year", () => {
    const plans = [{ year: 2026, version: 1, status: "APPROVED" }, { year: 2026, version: 2, status: "DRAFT" }, { year: 2025, version: 3, status: "APPROVED" }];
    expect(currentPlan(plans, 2026)?.version).toBe(1);
    expect(currentPlan([{ year: 2026, version: 1, status: "DRAFT" }], 2026)?.status).toBe("DRAFT");
    expect(currentPlan(plans, 2027)).toBeNull();
  });
});

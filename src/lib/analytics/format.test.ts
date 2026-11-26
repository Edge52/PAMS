import { describe, expect, it } from "vitest";
import { formatKpiValue, kpiShown, NOT_ENOUGH } from "./format";

describe("KPI values", () => {
  it("shows shares as percentages", () => expect(formatKpiValue({ value: 0.9456, unit: "share" })).toBe("94.6 %"));
  it("shows hours and days", () => {
    expect(formatKpiValue({ value: 12.34, unit: "hours" })).toBe("12.3 h");
    expect(formatKpiValue({ value: 1, unit: "days" })).toBe("1 day");
  });
  it("shows a dash without a value", () => expect(formatKpiValue({ value: null, unit: "number" })).toBe("—"));
});

describe("comparisons", () => {
  it("hides a benchmark comparison on fewer than 5 items", () => {
    expect(kpiShown({ n: 4, value: 1, benchmark: { text: "x", source: "y" } })).toEqual({ show: false, reason: NOT_ENOUGH });
    expect(kpiShown({ n: 5, value: 1, benchmark: { text: "x", source: "y" } })).toEqual({ show: true });
  });
  it("shows plain counts whatever n is", () => expect(kpiShown({ n: 1, value: 1 })).toEqual({ show: true }));
});

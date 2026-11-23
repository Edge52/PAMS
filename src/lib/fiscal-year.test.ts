import { describe, expect, it } from "vitest";
import { cleanStartMonth, fiscalYearLabel, fiscalYearOf, fiscalYearOptions, fiscalYearRange, parseFiscalYear } from "./fiscal-year";

describe("fiscalYearOf", () => {
  it("splits at 1 July by default", () => {
    expect(fiscalYearOf("2026-06-30")).toBe(2025);
    expect(fiscalYearOf("2026-07-01")).toBe(2026);
    expect(fiscalYearOf("2026-12-31")).toBe(2026);
    expect(fiscalYearOf("2027-01-01")).toBe(2026);
  });
  it("is the calendar year with a January start", () => {
    expect(fiscalYearOf("2026-01-01", 1)).toBe(2026);
    expect(fiscalYearOf("2026-12-31", 1)).toBe(2026);
  });
  it("reads a Date in Cairo time", () => {
    // 30 June 2026 22:30 UTC is already 1 July 01:30 in Cairo (UTC+3 in summer).
    expect(fiscalYearOf(new Date("2026-06-30T22:30:00Z"))).toBe(2026);
    expect(fiscalYearOf(new Date("2026-06-30T20:00:00Z"))).toBe(2025);
  });
  it("other start months", () => {
    expect(fiscalYearOf("2026-03-31", 4)).toBe(2025);
    expect(fiscalYearOf("2026-04-01", 4)).toBe(2026);
  });
  it("falls back to July for a bad start month", () => {
    expect(cleanStartMonth(0)).toBe(7);
    expect(cleanStartMonth("13")).toBe(7);
    expect(cleanStartMonth("3")).toBe(3);
    expect(fiscalYearOf("2026-06-30", 99)).toBe(2025);
  });
});

describe("labels and ranges", () => {
  it("labels", () => {
    expect(fiscalYearLabel(2026)).toBe("FY 2026/27");
    expect(fiscalYearLabel(2099)).toBe("FY 2099/00");
    expect(fiscalYearLabel(2026, 1)).toBe("FY 2026");
  });
  it("parses labels", () => {
    expect(parseFiscalYear("FY 2026/27")).toBe(2026);
    expect(parseFiscalYear("2026/2027")).toBe(2026);
    expect(parseFiscalYear("2026-27")).toBe(2026);
    expect(parseFiscalYear(2026)).toBe(2026);
    expect(parseFiscalYear("2026/28")).toBeNull();
    expect(parseFiscalYear("next year")).toBeNull();
  });
  it("ranges", () => {
    expect(fiscalYearRange("FY 2026/27")).toEqual({ year: 2026, label: "FY 2026/27", start: "2026-07-01", end: "2027-06-30" });
    expect(fiscalYearRange(2026, 1)).toEqual({ year: 2026, label: "FY 2026", start: "2026-01-01", end: "2026-12-31" });
    expect(fiscalYearRange(2027, 3)?.end).toBe("2028-02-29");
    expect(fiscalYearRange("x")).toBeNull();
  });
  it("every date of a range falls in its year", () => {
    const r = fiscalYearRange(2026)!;
    expect(fiscalYearOf(r.start)).toBe(2026);
    expect(fiscalYearOf(r.end)).toBe(2026);
  });
  it("options", () => {
    expect(fiscalYearOptions(2026).map((o) => o.label)).toEqual(["FY 2025/26", "FY 2026/27", "FY 2027/28", "FY 2028/29"]);
    expect(fiscalYearOptions(2026, 7, [2020]).length).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { budgetForecast, budgetTotals, fiscalMonthIndex, flagOf, monthsGone, seasonalForecast, seasonShape, shareGone, straightForecast } from "./budget";

describe("budget forecast", () => {
  it("counts budget-year months from the start month", () => {
    expect(fiscalMonthIndex("2026-07-03", 7)).toBe(0);
    expect(fiscalMonthIndex("2027-06-30", 7)).toBe(11);
    expect(fiscalMonthIndex("2026-01-15", 1)).toBe(0);
  });

  it("works out months gone, fractional by month length", () => {
    expect(monthsGone("2026-07-01", "2027-06-30", "2026-06-30")).toBe(0);
    expect(monthsGone("2026-07-01", "2027-06-30", "2026-07-31")).toBeCloseTo(1);
    expect(monthsGone("2026-07-01", "2027-06-30", "2026-08-15")).toBeCloseTo(1 + 15 / 31);
    expect(monthsGone("2026-07-01", "2027-06-30", "2027-08-01")).toBe(12);
    expect(monthsGone("2026-07-01", "2027-06-30", "2026-12-31")).toBeCloseTo(6);
  });

  it("projects spend in a straight line and adds committed", () => {
    expect(straightForecast(300, 100, 3)).toBe(1300);
    expect(straightForecast(300, 100, 0)).toBeNull();
  });

  it("uses last year's shape for the seasonal forecast", () => {
    const monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; monthly[0] = 10; monthly[11] = 90;
    const shape = seasonShape(monthly)!;
    expect(shape[0]).toBeCloseTo(0.1);
    expect(shareGone(shape, 1)).toBeCloseTo(0.1);
    expect(shareGone(shape, 0.5)).toBeCloseTo(0.05);
    expect(seasonalForecast(50, 20, 1, shape)).toBeCloseTo(520);
    expect(seasonalForecast(50, 20, 0.2, shape)).toBeNull(); // under 5 % of last year in the months gone
    expect(seasonShape([1, 2])).toBeNull();
    expect(seasonShape(new Array(12).fill(0))).toBeNull();
  });

  it("flags lines over 100 % or under 70 % (not in the first month)", () => {
    expect(flagOf(1.2, 6)).toBe("over");
    expect(flagOf(0.5, 6)).toBe("under");
    expect(flagOf(0.5, 0.5)).toBe("ok");
    expect(flagOf(0.9, 6)).toBe("ok");
    expect(flagOf(null, 6)).toBeNull();
  });

  it("never forecasts below what is used, and totals the lines", () => {
    const rows = budgetForecast([
      { id: 1, name: "CT", kind: "CAPITAL", facilityId: 1, amount: 1000, committed: 900, spent: 0 },
      { id: 2, name: "Repairs", kind: "MAINTENANCE", facilityId: 1, amount: 1200, committed: 0, spent: 600, lastYearMonthly: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      { id: 3, name: "Empty", kind: "CAPITAL", facilityId: 1, amount: 0, committed: 0, spent: 0 },
    ], 6, "seasonal");
    expect(rows[0].forecast).toBe(900);
    expect(rows[0].flag).toBe("ok");
    expect(rows[1].method).toBe("seasonal");
    expect(rows[1].forecast).toBeCloseTo(1200);
    expect(rows[0].method).toBe("straight");
    expect(rows[2].forecastPct).toBeNull();
    const t = budgetTotals(rows);
    expect(t.amount).toBe(2200);
    expect(t.forecast).toBeCloseTo(2100);
    expect(t.lines).toBe(3);
  });

  it("flags a line spending fast", () => {
    const [r] = budgetForecast([{ id: 1, name: "X", kind: "CAPITAL", facilityId: 1, amount: 1000, committed: 0, spent: 600 }], 3);
    expect(r.forecast).toBe(2400);
    expect(r.flag).toBe("over");
  });
});

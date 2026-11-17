import { describe, expect, it } from "vitest";
import { depreciation, depreciationTerms, inServiceDate } from "./depreciation";

describe("depreciation (straight line)", () => {
  it("writes off part years by the day", () => {
    // 10-year life from 1 Jan 2020, no residual: halfway on 1 Jan 2025 (5 of 10 years).
    const d = depreciation({ cost: 100_000, inService: "2020-01-01", lifeYears: 10 }, "2025-01-01");
    expect(d.state).toBe("DEPRECIATING");
    expect(d.perYear).toBe(10_000);
    expect(d.accumulated).toBeCloseTo(50_000, -2);
    expect(d.bookValue).toBeCloseTo(50_000, -2);
    expect(d.yearsLeft).toBeCloseTo(5, 1);
    expect(d.endsOn).toBe("2030-01-01");
    // Three months in: about a quarter of a year.
    const q = depreciation({ cost: 120_000, inService: "2026-01-01", lifeYears: 10 }, "2026-04-01");
    expect(q.accumulated).toBeGreaterThan(2900);
    expect(q.accumulated).toBeLessThan(3000);
  });

  it("stops at the residual value", () => {
    const d = depreciation({ cost: 200_000, inService: "2010-06-15", lifeYears: 8, residualPct: 10 }, "2026-11-17");
    expect(d.state).toBe("FULLY_DEPRECIATED");
    expect(d.residual).toBe(20_000);
    expect(d.bookValue).toBe(20_000);
    expect(d.accumulated).toBe(180_000);
    expect(d.yearsLeft).toBe(0);
    expect(d.pctWrittenOff).toBe(100);
    // Exactly on the end date it is fully written off too.
    expect(depreciation({ cost: 1000, inService: "2020-03-01", lifeYears: 5 }, "2025-03-01").state).toBe("FULLY_DEPRECIATED");
  });

  it("keeps the full cost before the in-service date", () => {
    const d = depreciation({ cost: 5000, inService: "2027-01-01", lifeYears: 5, residualPct: 20 }, "2026-11-17");
    expect(d.state).toBe("NOT_STARTED");
    expect(d.bookValue).toBe(5000);
    expect(d.accumulated).toBe(0);
  });

  it("says what is missing instead of guessing", () => {
    expect(depreciation({ cost: null, inService: "2020-01-01", lifeYears: 10 }, "2026-01-01")).toMatchObject({ state: "NO_COST", bookValue: null });
    expect(depreciation({ cost: 1000, inService: null, lifeYears: 10 }, "2026-01-01")).toMatchObject({ state: "NO_DATE", bookValue: 1000, accumulated: null });
    expect(depreciation({ cost: 1000, inService: "2020-01-01", lifeYears: null }, "2026-01-01")).toMatchObject({ state: "NO_LIFE", bookValue: 1000 });
    expect(depreciation({ cost: 1000, inService: "2020-01-01", lifeYears: 0 }, "2026-01-01").state).toBe("NO_LIFE");
  });

  it("is currency-free: the same figures in any currency", () => {
    const usd = depreciation({ cost: 10_000, inService: "2022-01-01", lifeYears: 4 }, "2024-01-01");
    expect(usd.bookValue).toBeCloseTo(5000, -1);
    // Converting to EGP afterwards is the caller's job (rate × value).
    expect((usd.bookValue ?? 0) * 48.5).toBeCloseTo(242_500, -3);
  });

  it("clamps an impossible residual", () => {
    expect(depreciation({ cost: 1000, inService: "2000-01-01", lifeYears: 5, residualPct: 150 }, "2026-01-01").bookValue).toBe(1000);
    expect(depreciation({ cost: 1000, inService: "2000-01-01", lifeYears: 5, residualPct: -5 }, "2026-01-01").bookValue).toBe(0);
  });
});

describe("terms and start date", () => {
  it("prefers the asset's figures, then the type's", () => {
    expect(depreciationTerms({ lifeYears: 7, residualPct: 5 }, { lifeYears: 10, residualPct: 10 })).toEqual({ lifeYears: 7, residualPct: 5 });
    expect(depreciationTerms({ lifeYears: null, residualPct: null }, { lifeYears: 10, residualPct: 10 })).toEqual({ lifeYears: 10, residualPct: 10 });
    expect(depreciationTerms({}, {})).toEqual({ lifeYears: null, residualPct: 0 });
  });
  it("starts from acceptance, then install, then purchase", () => {
    expect(inServiceDate({ acceptedOn: "2024-03-01", installDate: "2024-02-01", purchaseDate: "2024-01-01" })).toEqual({ date: "2024-03-01", basis: "ACCEPTED" });
    expect(inServiceDate({ installDate: "2024-02-01", purchaseDate: "2024-01-01" })).toEqual({ date: "2024-02-01", basis: "INSTALLED" });
    expect(inServiceDate({ purchaseDate: "2024-01-01" })).toEqual({ date: "2024-01-01", basis: "PURCHASED" });
    expect(inServiceDate({})).toEqual({ date: null, basis: null });
  });
});

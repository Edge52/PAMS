import { describe, expect, it } from "vitest";
import { ANALYTICS_TABS, comparable, filterQuery, mad, median, parseFilters, periodDays, perUnit, robustZ } from "./core";

describe("analytics core", () => {
  it("lists each tab once under /analytics", () => {
    const ids = ANALYTICS_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ANALYTICS_TABS.every((t) => t.href.startsWith("/analytics"))).toBe(true);
  });

  it("defaults the period to the 12 months up to today", () => {
    const f = parseFilters({}, "2026-11-26");
    expect(f).toEqual({ facilityId: null, departmentId: null, deviceTypeId: null, from: "2025-11-27", to: "2026-11-26" });
    expect(periodDays(f)).toBe(365);
  });

  it("reads ids and dates, and ignores bad ones", () => {
    const f = parseFilters({ facilityId: "3", departmentId: "x", from: "2026-01-01", to: "2026-03-31" }, "2026-11-26");
    expect(f.facilityId).toBe(3);
    expect(f.departmentId).toBeNull();
    expect(f.from).toBe("2026-01-01");
    expect(parseFilters({ from: "2027-01-01", to: "2026-03-31" }, "2026-11-26").from).toBe("2025-04-01");
    expect(filterQuery(f)).toBe("facilityId=3&from=2026-01-01&to=2026-03-31");
  });

  it("hides small comparisons and divides safely", () => {
    expect(comparable(4)).toBe(false);
    expect(comparable(5)).toBe(true);
    expect(perUnit(10, 0)).toBeNull();
    expect(perUnit(50, 200, 1000)).toBe(250);
  });

  it("works out median, MAD and robust scores", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(robustZ(100, [1, 2, 3, 4, 100])!).toBeGreaterThan(3.5);
    expect(robustZ(5, [1, 2, 3])).toBeNull();
    expect(robustZ(5, [2, 2, 2, 2, 2])).toBeNull();
  });
});

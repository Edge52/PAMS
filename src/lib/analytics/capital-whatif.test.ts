import { describe, expect, it } from "vitest";
import { cleanSettings, planCapital, replacementWave, typeIncluded, type PlanDevice } from "./capital-whatif";

const dev = (id: number, dueYear: number, cost: number | null, score = 50, typeCode = "IMG-CT-64"): PlanDevice =>
  ({ id, tag: `T-${id}`, typeCode, typeName: typeCode, dueYear, cost, score });

describe("capital what-if", () => {
  it("cleans settings", () => {
    expect(cleanSettings({ delayYears: "2", budgetPerYear: "1,000,000", includeTypes: "img-ct, mon" })).toEqual({ delayYears: 2, budgetPerYear: 1_000_000, includeTypes: ["IMG-CT", "MON"] });
    expect(cleanSettings({ delayYears: 99, budgetPerYear: "", includeTypes: ["<x>"] })).toEqual({ delayYears: 10, budgetPerYear: null, includeTypes: [] });
    expect(cleanSettings(null)).toEqual({ delayYears: 0, budgetPerYear: null, includeTypes: [] });
  });

  it("matches types by code or prefix", () => {
    expect(typeIncluded("IMG-CT-64", ["IMG-CT"])).toBe(true);
    expect(typeIncluded("IMG-CTX", ["IMG-CT"])).toBe(false);
    expect(typeIncluded("ANY", [])).toBe(true);
  });

  it("counts the replacement wave, overdue devices in this year", () => {
    const w = replacementWave([dev(1, 2020, 100), dev(2, 2026, null), dev(3, 2028, 50), dev(4, 2040, 10)], 2026, 10);
    expect(w).toHaveLength(10);
    expect(w[0]).toEqual({ year: 2026, devices: 2, cost: 100, unpriced: 1 });
    expect(w[2].cost).toBe(50);
    expect(w.reduce((s, y) => s + y.devices, 0)).toBe(3);
  });

  it("replaces everything in its due year without a cap", () => {
    const p = planCapital([dev(1, 2026, 100), dev(2, 2027, 100)], { delayYears: 0, budgetPerYear: null, includeTypes: [] }, 2026, 3);
    expect(p.devices.map((d) => d.replaceYear)).toEqual([2026, 2027]);
    expect(p.years[0].backlog).toBe(0);
  });

  it("clears a backlog under a cap, highest score first, filling with cheaper ones", () => {
    const p = planCapital([dev(1, 2026, 60, 90), dev(2, 2026, 60, 80), dev(3, 2026, 30, 10), dev(4, 2026, 500, 99)], { delayYears: 0, budgetPerYear: 100, includeTypes: [] }, 2026, 3);
    const year = (id: number) => p.devices.find((d) => d.id === id)!.replaceYear;
    expect(year(1)).toBe(2026);
    expect(year(3)).toBe(2026); // fits in the 40 left
    expect(year(2)).toBe(2027);
    expect(year(4)).toBeNull();
    expect(p.tooCostly).toBe(1);
    expect(p.years[0]).toMatchObject({ spent: 90, replaced: 2, backlog: 2, backlogCost: 560 });
    expect(p.devices.find((d) => d.id === 2)!.waitYears).toBe(1);
  });

  it("delays and filters by type", () => {
    const p = planCapital([dev(1, 2026, 10), dev(2, 2026, 10, 50, "MON-PAT")], { delayYears: 2, budgetPerYear: null, includeTypes: ["IMG"] }, 2026, 5);
    expect(p.devices).toHaveLength(1);
    expect(p.devices[0].replaceYear).toBe(2028);
    expect(p.years[2].becameDue).toBe(1);
  });

  it("places unpriced devices at no cost", () => {
    const p = planCapital([dev(1, 2026, null)], { delayYears: 0, budgetPerYear: 0, includeTypes: [] }, 2026, 2);
    expect(p.devices[0].replaceYear).toBe(2026);
    expect(p.years[0].unpriced).toBe(1);
  });
});

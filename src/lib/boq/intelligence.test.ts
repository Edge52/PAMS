import { describe, expect, it } from "vitest";
import { fitToBudget, type FitLine } from "./fit-budget";
import { checkBenchmarks, matchesDevice } from "./benchmarks";
import { riskFlags } from "./risks";

const line = (id: number, tier: FitLine["tier"], qty: number, prices: [number, number, number], at: FitLine["priceTier"] = "STANDARD", manual = false): FitLine => ({
  id, name: `Item ${id}`, department: "ICU", tier, quantity: qty, priceManual: manual, priceTier: at,
  unitPrice: { BASIC: prices[0], STANDARD: prices[1], PREMIUM: prices[2] }[at], tierPrices: { BASIC: prices[0], STANDARD: prices[1], PREMIUM: prices[2] },
});

describe("fit to budget", () => {
  it("does nothing when already within the target", () => {
    expect(fitToBudget([line(1, "OPTIONAL", 1, [5, 10, 15])], 100, 0)).toMatchObject({ reached: true, changes: [] });
  });
  it("drops optional lines first, biggest first, and stops when within", () => {
    const r = fitToBudget([line(1, "ESSENTIAL", 1, [50, 100, 150]), line(2, "OPTIONAL", 1, [10, 20, 30]), line(3, "OPTIONAL", 1, [40, 50, 60])], 130, 0);
    expect(r.changes.map((c) => [c.kind, c.lineId])).toEqual([["drop", 3]]);
    expect(r).toMatchObject({ before: 170, after: 120, reached: true });
  });
  it("then moves recommended lines down a tier, never essential or hand-typed ones, counting contingency", () => {
    const r = fitToBudget([line(1, "ESSENTIAL", 2, [50, 100, 150], "PREMIUM"), line(2, "RECOMMENDED", 2, [40, 60, 100], "PREMIUM"), line(3, "RECOMMENDED", 1, [10, 50, 90], "PREMIUM", true)], 400, 10);
    // before: (300 + 200 + 90) × 1.1 = 649; line 2 premium→standard saves 88, →basic 44 more; still over
    expect(r.changes).toEqual([expect.objectContaining({ kind: "tier", lineId: 2, from: "PREMIUM", to: "BASIC", unitPrice: 40, saving: 132 })]);
    expect(r).toMatchObject({ before: 649, after: 517, reached: false, untouchable: 429 });
  });
});

describe("benchmarks", () => {
  it("matches codes and prefixes", () => {
    expect(matchesDevice("IMG-CT-64", ["IMG-CT-"])).toBe(true);
    expect(matchesDevice("IMG-ACC-CTINJ", ["IMG-CT-"])).toBe(false);
  });
  it("flags densities under and over the range", () => {
    const r = checkBenchmarks(
      [{ id: 1, label: "ICU", departmentTypeCode: "ICU", beds: 10, rooms: 10, instances: 1 }, { id: 2, label: "Radiology", departmentTypeCode: "RAD", beds: 0, rooms: 4, instances: 1 }],
      [{ boqDepartmentId: 1, deviceCode: "LIF-VEN-ICU", quantity: 4 }, { boqDepartmentId: 1, deviceCode: "MON-PAT-HIGH", quantity: 10 }, { boqDepartmentId: 2, deviceCode: "IMG-CT-64", quantity: 2 }],
      200,
    );
    const by = (l: string) => r.find((x) => x.label === l)!;
    expect(by("ICU ventilators")).toMatchObject({ value: 0.4, status: "under" });
    expect(by("High-acuity monitors").status).toBe("ok");
    expect(by("Syringe pumps")).toMatchObject({ quantity: 0, status: "under" });
    expect(by("CT scanners per 100 hospital beds")).toMatchObject({ value: 1, status: "over" });
  });
});

describe("risk flags", () => {
  const base = { currency: "USD", grandTotal: 1000, targetBudget: null, unpricedLines: 0, money: (n: number) => `$${n}` };
  it("flags a single CT, an ICU short of ventilators and monitors, budget and unpriced lines", () => {
    const f = riskFlags({ ...base, targetBudget: 800, unpricedLines: 2,
      depts: [{ id: 1, label: "ICU", departmentTypeCode: "ICU", beds: 10, instances: 1 }, { id: 2, label: "Radiology", departmentTypeCode: "RAD", beds: 0, instances: 1 }],
      lines: [{ boqDepartmentId: 1, deviceCode: "LIF-VEN-ICU", deviceName: "Ventilator", quantity: 3, tier: "ESSENTIAL", calculatedQty: 10, isOverridden: true, unitPrice: 1 },
        { boqDepartmentId: 2, deviceCode: "IMG-CT-64", deviceName: "CT", quantity: 1, tier: "ESSENTIAL", calculatedQty: 1, isOverridden: false, unitPrice: 1 }],
      fleet: [{ name: "Ventilator, ICU", units: 12, makers: 1, maker: "Dräger" }, { name: "Pump", units: 3, makers: 1, maker: "X" }],
    });
    expect(f.map((x) => x.key)).toEqual(["single:CT scanner", "vent:1", "mon:1", "budget", "defib:1", "unpriced", "fleet:Ventilator, ICU"]);
    expect(f.find((x) => x.key === "budget")!.severity).toBe("high");
  });
});

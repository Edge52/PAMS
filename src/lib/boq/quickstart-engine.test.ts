import { describe, expect, it } from "vitest";
import { companionLines, generateLines, type DepartmentInput, type RuleInput } from "./engine";
import { effectiveTier, scenarioTotals, tierPriceUsd } from "./pricing";
import { cleanFeatures, cleanParams } from "./questions";

const rule = (o: Partial<RuleInput>): RuleInput => ({ id: 1, departmentTypeCode: "RAD", deviceTypeId: 100, basis: "PER_HOSPITAL_BEDS", ratio: 0.004, minQty: 1, maxQty: null, rounding: "CEIL", tier: "ESSENTIAL", ...o });
const rad: DepartmentInput = { id: 10, departmentTypeCode: "RAD", label: "Radiology", beds: 0, rooms: 6, instances: 1 };
const ldr: DepartmentInput = { id: 11, departmentTypeCode: "LDR", label: "Labour & delivery", beds: 6, rooms: 6, instances: 1 };
const base = { totalHospitalBeds: 200, includeTiers: ["ESSENTIAL", "RECOMMENDED"] as const };

describe("throughput rules", () => {
  it("use the department's answer instead of the bed ratio", () => {
    const r = rule({ param: "ctExams", paramRatio: 1 / 15000 });
    const [l] = generateLines({ ...base, rules: [r], departments: [{ ...rad, params: { ctExams: 18000 } }] });
    expect(l.calculatedQty).toBe(2);
    expect(l.explanation).toBe("18,000 CT exams a year × 1 per 15,000 = 1.2, rounded up → 2");
  });
  it("plan none when the answer is 0, whatever the minimum", () => {
    expect(generateLines({ ...base, rules: [rule({ param: "mriExams", paramRatio: 1 / 6000 })], departments: [{ ...rad, params: { mriExams: 0 } }] })).toEqual([]);
  });
  it("fall back to the basis when the question isn't answered", () => {
    const [l] = generateLines({ ...base, rules: [rule({ param: "ctExams", paramRatio: 1 / 15000 })], departments: [rad] });
    expect(l.calculatedQty).toBe(1); // 200 beds × 1 per 250 = 0.8 → 1
    expect(l.explanation).toMatch(/200 hospital beds/);
  });
  it("aren't multiplied by instances, and respect min and max", () => {
    const r = rule({ basis: "PER_BED", ratio: 1, param: "deliveries", paramRatio: 1 / 400, departmentTypeCode: "LDR", maxQty: 8 });
    const [l] = generateLines({ ...base, rules: [r], departments: [{ ...ldr, instances: 2, params: { deliveries: 5000 } }] });
    expect(l.calculatedQty).toBe(8);
    expect(l.explanation).toMatch(/5,000 deliveries a year × 1 per 400 = 12\.5, rounded up → 13, maximum 8 → 8/);
  });
});

describe("conditional rules", () => {
  const rules = [rule({ id: 1 }), rule({ id: 2, basis: "FIXED", ratio: 1, deviceTypeId: 101, condition: "trauma" })];
  it("apply only when the feature is on, and say why", () => {
    expect(generateLines({ ...base, rules, departments: [rad] }).map((l) => l.deviceTypeId)).toEqual([100]);
    const with_ = generateLines({ ...base, rules, departments: [rad], features: ["trauma"] });
    expect(with_.map((l) => l.deviceTypeId)).toEqual([100, 101]);
    expect(with_[1].explanation).toBe("Trauma centre: Fixed quantity 1");
  });
  it("can add to a device the base rules already plan", () => {
    const both = [rule({ id: 1 }), rule({ id: 2, basis: "FIXED", ratio: 1, condition: "trauma" })];
    const lines = generateLines({ ...base, rules: both, departments: [rad], features: ["trauma"] });
    expect(lines.filter((l) => l.deviceTypeId === 100).map((l) => l.calculatedQty)).toEqual([1, 1]);
  });
});

describe("companion items", () => {
  const names = (id: number) => ({ 100: "CT scanner", 200: "CT injector", 300: "UPS", 400: "Delivery bed", 500: "CTG" } as Record<number, string>)[id] ?? "?";
  it("top up only the shortfall in the same department", () => {
    const lines = [
      { boqDepartmentId: 10, deviceTypeId: 100, ruleId: 1, tier: "ESSENTIAL" as const, calculatedQty: 2, explanation: "" },
      { boqDepartmentId: 10, deviceTypeId: 200, ruleId: 2, tier: "ESSENTIAL" as const, calculatedQty: 1, explanation: "" },
    ];
    const extra = companionLines(lines, [{ deviceTypeId: 100, companionTypeId: 200, ratio: 1 }, { deviceTypeId: 100, companionTypeId: 300, ratio: 1 }], names);
    expect(extra).toEqual([
      expect.objectContaining({ deviceTypeId: 200, calculatedQty: 1, ruleId: null, explanation: "Comes with 2 × CT scanner = 2; 1 already planned → 1 more" }),
      expect.objectContaining({ deviceTypeId: 300, calculatedQty: 2, explanation: "Comes with 2 × CT scanner = 2" }),
    ]);
  });
  it("add nothing when the rules already cover it, and round fractional ratios up", () => {
    const lines = [{ boqDepartmentId: 11, deviceTypeId: 400, ruleId: 1, tier: "RECOMMENDED" as const, calculatedQty: 3, explanation: "" }];
    expect(companionLines([...lines, { ...lines[0], deviceTypeId: 500, calculatedQty: 3 }], [{ deviceTypeId: 400, companionTypeId: 500, ratio: 1 }], names)).toEqual([]);
    const half = companionLines(lines, [{ deviceTypeId: 400, companionTypeId: 500, ratio: 0.5 }], names);
    expect(half[0]).toMatchObject({ calculatedQty: 2, tier: "RECOMMENDED", explanation: "Comes with 3 × Delivery bed (0.5 each) = 2" });
  });
  it("run as part of generation", () => {
    const lines = generateLines({ ...base, rules: [rule({ id: 1, basis: "FIXED", ratio: 2 })], departments: [rad],
      companions: [{ deviceTypeId: 100, companionTypeId: 200, ratio: 1 }], deviceName: names });
    expect(lines.map((l) => [l.deviceTypeId, l.calculatedQty])).toEqual([[100, 2], [200, 2]]);
  });
});

describe("price tiers", () => {
  it("price from the band", () => {
    expect(tierPriceUsd(250000, 450000, "BASIC")).toBe(250000);
    expect(tierPriceUsd(250000, 450000, "STANDARD")).toBe(350000);
    expect(tierPriceUsd(250000, 450000, "PREMIUM")).toBe(450000);
    expect(tierPriceUsd(null, 9000, "BASIC")).toBe(9000);
    expect(tierPriceUsd(null, null, "PREMIUM")).toBeNull();
  });
  it("inherit line → department → BOQ", () => {
    expect(effectiveTier(null, null, "STANDARD")).toBe("STANDARD");
    expect(effectiveTier(null, "PREMIUM", "STANDARD")).toBe("PREMIUM");
    expect(effectiveTier("BASIC", "PREMIUM", "STANDARD")).toBe("BASIC");
  });
  it("compare scenarios, keeping hand-typed prices", () => {
    const s = scenarioTotals([
      { quantity: 2, min: 100, max: 300, currentPrice: null, priceManual: false },
      { quantity: 1, min: 10, max: 20, currentPrice: "500", priceManual: true },
      { quantity: 4, min: null, max: null, currentPrice: null, priceManual: false },
    ], (x) => x / 50, 10);
    expect(s.byTier.BASIC).toEqual({ subtotal: 210, total: 231 });
    expect(s.byTier.STANDARD.subtotal).toBe(410);
    expect(s.byTier.PREMIUM.subtotal).toBe(610);
    expect(s.unpriced).toBe(1);
  });
});

describe("form input", () => {
  it("keeps only known features and answers", () => {
    expect(cleanFeatures(["trauma", "hack", "trauma"])).toEqual(["trauma"]);
    expect(cleanParams("RAD", { ctExams: "18000", mriExams: "", bogus: 5, xrayExams: "-3", usExams: "0" })).toEqual({ ctExams: 18000, usExams: 0 });
    expect(cleanParams("OPD", { ctExams: 1 })).toEqual({});
  });
});

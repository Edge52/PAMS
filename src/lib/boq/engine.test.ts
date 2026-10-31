import { describe, expect, it } from "vitest";
import { indexDevices, searchDevices } from "./device-search";
import {
  applyRounding, calculateQuantity, describeRatio, effectiveHospitalBeds, generateLines, mergeRegeneration,
  needsHospitalWideDepartment, parseRatio, ratioHint, reciprocal, summarizeMerge, ORPHANED_OVERRIDE_NOTE,
  type DepartmentInput, type ExistingLine, type RuleInput,
} from "./engine";
import { computeTotals, midpointUsd } from "./pricing";

let nextRuleId = 1;
const rule = (p: Partial<RuleInput> & Pick<RuleInput, "basis" | "ratio">): RuleInput => ({
  id: nextRuleId++, departmentTypeCode: "ICU", deviceTypeId: 100, minQty: 0, maxQty: null, rounding: "CEIL", tier: "ESSENTIAL", ...p,
});
const dept = (p: Partial<DepartmentInput> = {}): DepartmentInput => ({
  id: 1, departmentTypeCode: "ICU", label: "Adult ICU", beds: 12, rooms: 0, instances: 1, ...p,
});

describe("basis", () => {
  it("PER_BED multiplies department beds", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 1 }), dept({ beds: 12 }), 200);
    expect(r.qty).toBe(12);
    expect(r.explanation).toBe("12 beds × 1 per bed = 12");
  });

  it("PER_ROOM multiplies department rooms", () => {
    const r = calculateQuantity(rule({ basis: "PER_ROOM", ratio: 0.5 }), dept({ rooms: 6 }), 200);
    expect(r.qty).toBe(3);
    expect(r.explanation).toBe("6 rooms × 0.5 per room = 3");
  });

  it("PER_DEPARTMENT is ratio × 1", () => {
    const r = calculateQuantity(rule({ basis: "PER_DEPARTMENT", ratio: 2 }), dept(), 200);
    expect(r.qty).toBe(2);
    expect(r.explanation).toBe("2 per department = 2");
  });

  it("PER_HOSPITAL_BEDS uses total hospital beds and reads as 1 per N beds", () => {
    const r = calculateQuantity(rule({ basis: "PER_HOSPITAL_BEDS", ratio: 0.01, minQty: 1 }), dept({ beds: 0 }), 200);
    expect(r.qty).toBe(2);
    expect(r.explanation).toBe("200 hospital beds × 1 per 100 beds = 2");
  });

  it("PER_HOSPITAL_BEDS with a non-reciprocal ratio shows the decimal", () => {
    const r = calculateQuantity(rule({ basis: "PER_HOSPITAL_BEDS", ratio: 0.03 }), dept(), 100);
    expect(r.qty).toBe(3);
    expect(r.explanation).toBe("100 hospital beds × 0.03 per bed = 3");
  });

  it("FIXED is the ratio itself, independent of beds and rooms", () => {
    const r = calculateQuantity(rule({ basis: "FIXED", ratio: 4 }), dept({ beds: 99, rooms: 99 }), 999);
    expect(r.qty).toBe(4);
    expect(r.explanation).toBe("Fixed quantity 4");
  });

  it("singular units read naturally", () => {
    expect(calculateQuantity(rule({ basis: "PER_BED", ratio: 1 }), dept({ beds: 1 }), 0).explanation).toBe("1 bed × 1 per bed = 1");
    expect(calculateQuantity(rule({ basis: "PER_ROOM", ratio: 1 }), dept({ rooms: 1 }), 0).explanation).toBe("1 room × 1 per room = 1");
  });

  it("HOSP department with no beds uses hospital beds for PER_BED", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 0.1, departmentTypeCode: "HOSP" }), dept({ departmentTypeCode: "HOSP", beds: 0 }), 150);
    expect(r.qty).toBe(15);
    expect(r.explanation).toBe("150 hospital beds × 0.1 per bed = 15");
  });
});

describe("rounding", () => {
  it("CEIL rounds up and says so", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 0.25, rounding: "CEIL" }), dept({ beds: 10 }), 0);
    expect(r.qty).toBe(3);
    expect(r.explanation).toBe("10 beds × 0.25 per bed = 2.5, rounded up → 3");
  });
  it("FLOOR rounds down", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 0.25, rounding: "FLOOR" }), dept({ beds: 10 }), 0);
    expect(r.qty).toBe(2);
    expect(r.explanation).toContain("rounded down → 2");
  });
  it("ROUND goes to nearest (half up)", () => {
    expect(calculateQuantity(rule({ basis: "PER_BED", ratio: 0.25, rounding: "ROUND" }), dept({ beds: 10 }), 0).qty).toBe(3);
    expect(calculateQuantity(rule({ basis: "PER_BED", ratio: 0.2, rounding: "ROUND" }), dept({ beds: 11 }), 0).qty).toBe(2);
  });
  it("float noise never makes CEIL over-count (0.1 × 30 = 3, not 4)", () => {
    expect(applyRounding(0.1 * 3 * 10, "CEIL")).toBe(3);
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 0.1 }), dept({ beds: 30 }), 0);
    expect(r.qty).toBe(3);
    expect(r.explanation).toBe("30 beds × 0.1 per bed = 3");
  });
  it("no rounding note when the result is already whole", () => {
    expect(calculateQuantity(rule({ basis: "PER_BED", ratio: 0.5 }), dept({ beds: 12 }), 0).explanation).not.toContain("rounded");
  });
});

describe("min / max clamps", () => {
  it("minimum lifts a small result and is explained", () => {
    const r = calculateQuantity(rule({ basis: "PER_HOSPITAL_BEDS", ratio: 0.01, minQty: 1, rounding: "FLOOR" }), dept(), 50);
    expect(r.qty).toBe(1);
    expect(r.explanation).toBe("50 hospital beds × 1 per 100 beds = 0.5, rounded down → 0, minimum 1 → 1");
  });
  it("minimum applies even when the department has no beds", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 1, minQty: 2 }), dept({ beds: 0 }), 0);
    expect(r.qty).toBe(2);
  });
  it("maximum caps a large result and is explained", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 1, maxQty: 8 }), dept({ beds: 12 }), 0);
    expect(r.qty).toBe(8);
    expect(r.explanation).toBe("12 beds × 1 per bed = 12, maximum 8 → 8");
  });
  it("minimum is not mentioned when it does not bind", () => {
    expect(calculateQuantity(rule({ basis: "PER_BED", ratio: 1, minQty: 1 }), dept({ beds: 12 }), 0).explanation).not.toContain("minimum");
  });
});

describe("instances", () => {
  it("scales the per-instance quantity (clamps apply per instance)", () => {
    const r = calculateQuantity(rule({ basis: "PER_DEPARTMENT", ratio: 1, minQty: 2 }), dept({ instances: 3 }), 0);
    expect(r.perInstance).toBe(2);
    expect(r.qty).toBe(6);
    expect(r.explanation).toBe("1 per department = 1, minimum 2 → 2; × 3 instances = 6");
  });
  it("PER_BED with 2 instances doubles", () => {
    const r = calculateQuantity(rule({ basis: "PER_BED", ratio: 1, maxQty: 10 }), dept({ beds: 12, instances: 2 }), 0);
    expect(r.qty).toBe(20);
  });
  it("0 instances yields 0", () => {
    expect(calculateQuantity(rule({ basis: "FIXED", ratio: 3 }), dept({ instances: 0 }), 0).qty).toBe(0);
  });
});

describe("generateLines", () => {
  const rules: RuleInput[] = [
    rule({ id: 1, departmentTypeCode: "ICU", deviceTypeId: 10, basis: "PER_BED", ratio: 1, tier: "ESSENTIAL" }),
    rule({ id: 2, departmentTypeCode: "ICU", deviceTypeId: 11, basis: "PER_BED", ratio: 0.5, tier: "RECOMMENDED" }),
    rule({ id: 3, departmentTypeCode: "ICU", deviceTypeId: 12, basis: "PER_DEPARTMENT", ratio: 1, tier: "OPTIONAL" }),
    rule({ id: 4, departmentTypeCode: "OR", deviceTypeId: 20, basis: "PER_ROOM", ratio: 1 }),
    rule({ id: 5, departmentTypeCode: "HOSP", deviceTypeId: 30, basis: "PER_HOSPITAL_BEDS", ratio: 0.01, minQty: 1 }),
    rule({ id: 6, departmentTypeCode: "ICU", deviceTypeId: 13, basis: "PER_ROOM", ratio: 1 }), // ICU has 0 rooms → dropped
  ];
  const departments = [
    dept({ id: 1, departmentTypeCode: "ICU", beds: 10 }),
    dept({ id: 2, departmentTypeCode: "OR", label: "Theatres", beds: 0, rooms: 4 }),
    dept({ id: 3, departmentTypeCode: "HOSP", label: "Hospital-wide", beds: 0 }),
    dept({ id: 4, departmentTypeCode: "WARD-MED", label: "Medical ward", beds: 30 }), // no rules → nothing
  ];

  it("filters by tier", () => {
    const essentialOnly = generateLines({ rules, departments, totalHospitalBeds: 200, includeTiers: ["ESSENTIAL"] });
    expect(essentialOnly.map((l) => l.ruleId).sort()).toEqual([1, 4, 5]);
    const all = generateLines({ rules, departments, totalHospitalBeds: 200, includeTiers: ["ESSENTIAL", "RECOMMENDED", "OPTIONAL"] });
    expect(all.map((l) => l.ruleId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(all.find((l) => l.ruleId === 2)?.tier).toBe("RECOMMENDED");
  });

  it("drops zero-quantity lines and matches rules to department types", () => {
    const lines = generateLines({ rules, departments, totalHospitalBeds: 200, includeTiers: ["ESSENTIAL"] });
    expect(lines.find((l) => l.ruleId === 6)).toBeUndefined();
    expect(lines.find((l) => l.ruleId === 4)).toMatchObject({ boqDepartmentId: 2, deviceTypeId: 20, calculatedQty: 4 });
    expect(lines.find((l) => l.ruleId === 5)).toMatchObject({ boqDepartmentId: 3, calculatedQty: 2 });
    expect(lines.some((l) => l.boqDepartmentId === 4)).toBe(false);
  });

  it("applies the same rule to every department of that type", () => {
    const two = [...departments, dept({ id: 5, departmentTypeCode: "ICU", label: "Surgical ICU", beds: 6 })];
    const lines = generateLines({ rules, departments: two, totalHospitalBeds: 200, includeTiers: ["ESSENTIAL"] });
    expect(lines.filter((l) => l.ruleId === 1).map((l) => [l.boqDepartmentId, l.calculatedQty])).toEqual([[1, 10], [5, 6]]);
  });

  it("HOSP rules apply only to a hospital-wide department", () => {
    const noHosp = departments.filter((d) => d.departmentTypeCode !== "HOSP");
    expect(generateLines({ rules, departments: noHosp, totalHospitalBeds: 200, includeTiers: ["ESSENTIAL"] }).some((l) => l.ruleId === 5)).toBe(false);
    expect(needsHospitalWideDepartment({ rules, departments: noHosp, includeTiers: ["ESSENTIAL"] })).toBe(true);
    expect(needsHospitalWideDepartment({ rules, departments, includeTiers: ["ESSENTIAL"] })).toBe(false);
    // HOSP rules excluded by tier → no hospital-wide department needed
    expect(needsHospitalWideDepartment({ rules, departments: noHosp, includeTiers: ["OPTIONAL"] })).toBe(false);
  });

  it("falls back to the sum of department beds when total hospital beds is 0", () => {
    expect(effectiveHospitalBeds(0, departments)).toBe(40);
    expect(effectiveHospitalBeds(0, [dept({ beds: 10, instances: 2 })])).toBe(20);
    expect(effectiveHospitalBeds(120, departments)).toBe(120);
    const lines = generateLines({ rules, departments, totalHospitalBeds: 0, includeTiers: ["ESSENTIAL"] });
    expect(lines.find((l) => l.ruleId === 5)?.explanation).toBe("40 hospital beds × 1 per 100 beds = 0.4, rounded up → 1");
  });
});

describe("readable ratios", () => {
  it("describes every basis", () => {
    expect(describeRatio("PER_BED", 1)).toBe("1 per bed");
    expect(describeRatio("PER_ROOM", 0.5)).toBe("0.5 per room");
    expect(describeRatio("PER_DEPARTMENT", 2)).toBe("2 per department");
    expect(describeRatio("PER_HOSPITAL_BEDS", 0.01)).toBe("1 per 100 hospital beds");
    expect(describeRatio("PER_HOSPITAL_BEDS", 0.04)).toBe("1 per 25 hospital beds");
    expect(describeRatio("PER_HOSPITAL_BEDS", 0.03)).toBe("0.03 per hospital bed");
    expect(describeRatio("FIXED", 3)).toBe("3 fixed");
  });
  it("hints reciprocals for fractional bed/room ratios", () => {
    expect(ratioHint("PER_BED", 0.25)).toBe("1 per 4 beds");
    expect(ratioHint("PER_ROOM", 0.5)).toBe("1 per 2 rooms");
    expect(ratioHint("PER_BED", 0.3)).toBeNull();
    expect(ratioHint("PER_BED", 1)).toBeNull();
    expect(reciprocal(1 / 6)).toBe(6);
  });
});

describe("mergeRegeneration", () => {
  const ex = (p: Partial<ExistingLine> & Pick<ExistingLine, "id" | "deviceTypeId">): ExistingLine => ({
    boqDepartmentId: 1, ruleId: 1, tier: "ESSENTIAL", calculatedQty: 0, quantity: 0, isOverridden: false, isManual: false, calcExplanation: null, ...p,
  });
  const calc = (deviceTypeId: number, qty: number, boqDepartmentId = 1) => ({
    boqDepartmentId, deviceTypeId, ruleId: deviceTypeId, tier: "ESSENTIAL" as const, calculatedQty: qty, explanation: `calc ${qty}`,
  });

  it("keeps overridden quantities but refreshes calculated qty and explanation", () => {
    const plan = mergeRegeneration(
      [ex({ id: 1, deviceTypeId: 10, calculatedQty: 12, quantity: 15, isOverridden: true })],
      [calc(10, 14)],
    );
    expect(plan.updates).toEqual([{ id: 1, calculatedQty: 14, quantity: 15, tier: "ESSENTIAL", ruleId: 10, calcExplanation: "calc 14" }]);
    expect(plan.counts.overridesKept).toBe(1);
    expect(plan.changes[0]).toMatchObject({ kind: "override-kept", calculatedFrom: 12, calculatedTo: 14, to: 15 });
  });

  it("never touches manual lines, even for the same device in the same department", () => {
    const plan = mergeRegeneration(
      [ex({ id: 1, deviceTypeId: 10, quantity: 3, isManual: true, ruleId: null })],
      [calc(10, 5)],
    );
    expect(plan.updates).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.counts.manualKept).toBe(1);
  });

  it("updates changed lines, inserts new, deletes vanished, counts unchanged", () => {
    const plan = mergeRegeneration(
      [
        ex({ id: 1, deviceTypeId: 10, calculatedQty: 12, quantity: 12 }),
        ex({ id: 2, deviceTypeId: 11, calculatedQty: 3, quantity: 3 }),
        ex({ id: 3, deviceTypeId: 12, calculatedQty: 1, quantity: 1 }),
      ],
      [calc(10, 14), calc(11, 3), calc(13, 2)],
    );
    expect(plan.updates.map((u) => [u.id, u.quantity])).toEqual([[1, 14], [2, 3]]);
    expect(plan.inserts.map((i) => i.deviceTypeId)).toEqual([13]);
    expect(plan.deletes).toEqual([3]);
    expect(plan.counts).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: 1, overridesKept: 0 });
  });

  it("keeps an override the standard no longer produces, with calculatedQty 0 and a note", () => {
    const plan = mergeRegeneration([ex({ id: 7, deviceTypeId: 10, calculatedQty: 4, quantity: 6, isOverridden: true })], []);
    expect(plan.deletes).toEqual([]);
    expect(plan.updates[0]).toMatchObject({ id: 7, quantity: 6, calculatedQty: 0, calcExplanation: ORPHANED_OVERRIDE_NOTE });
    expect(plan.changes[0].kind).toBe("override-orphaned");
  });

  it("matches by department as well as device type", () => {
    const plan = mergeRegeneration(
      [ex({ id: 1, deviceTypeId: 10, boqDepartmentId: 1, quantity: 5, calculatedQty: 5 })],
      [calc(10, 5, 2)],
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.deletes).toEqual([1]);
  });

  it("summarises in plain language", () => {
    const plan = mergeRegeneration(
      [ex({ id: 1, deviceTypeId: 10, quantity: 12, calculatedQty: 12 }), ex({ id: 2, deviceTypeId: 11, quantity: 9, calculatedQty: 4, isOverridden: true })],
      [calc(10, 14), calc(11, 5)],
    );
    const s = summarizeMerge(plan, { department: () => "Adult ICU", device: (id) => `Device ${id}` });
    expect(s).toContain("0 lines added, 0 removed, 1 quantity changed, 0 unchanged, 1 manual override kept.");
    expect(s).toContain("• Adult ICU — Device 10: 12 → 14");
    expect(s).toContain("• Adult ICU — Device 11: kept your 9 (standard now says 5, was 4)");
  });

  it("says nothing changed when nothing did", () => {
    const plan = mergeRegeneration([ex({ id: 1, deviceTypeId: 10, quantity: 2, calculatedQty: 2 })], [calc(10, 2)]);
    expect(summarizeMerge(plan, { department: () => "", device: () => "" })).toContain("Nothing changed");
  });

  it("round-trips: regenerate → override → regenerate keeps the override", () => {
    const rules: RuleInput[] = [rule({ id: 1, departmentTypeCode: "ICU", deviceTypeId: 10, basis: "PER_BED", ratio: 1 })];
    const first = generateLines({ rules, departments: [dept({ beds: 12 })], totalHospitalBeds: 0, includeTiers: ["ESSENTIAL"] });
    const stored: ExistingLine[] = first.map((l, i) => ({
      id: i + 1, boqDepartmentId: l.boqDepartmentId, deviceTypeId: l.deviceTypeId, ruleId: l.ruleId, tier: l.tier,
      calculatedQty: l.calculatedQty, quantity: 15, isOverridden: true, isManual: false, calcExplanation: l.explanation,
    }));
    const second = generateLines({ rules, departments: [dept({ beds: 16 })], totalHospitalBeds: 0, includeTiers: ["ESSENTIAL"] });
    const plan = mergeRegeneration(stored, second);
    expect(plan.updates[0]).toMatchObject({ quantity: 15, calculatedQty: 16, calcExplanation: "16 beds × 1 per bed = 16" });
  });
});

describe("pricing", () => {
  it("midpoint of a USD band", () => {
    expect(midpointUsd("10000.00", "20000.00")).toBe(15000);
    expect(midpointUsd(null, "8000")).toBe(8000);
    expect(midpointUsd("5000", null)).toBe(5000);
    expect(midpointUsd(null, null)).toBeNull();
  });
  it("totals by department, category, contingency and grand total", () => {
    const t = computeTotals([
      { boqDepartmentId: 1, categoryKey: "MON", quantity: 10, unitPriceEstimate: "1000.00" },
      { boqDepartmentId: 1, categoryKey: "LIF", quantity: 2, unitPriceEstimate: "25000.50" },
      { boqDepartmentId: 2, categoryKey: "MON", quantity: 3, unitPriceEstimate: 500 },
      { boqDepartmentId: 2, categoryKey: "FUR", quantity: 4, unitPriceEstimate: null },
    ], 10);
    expect(t.byDepartment.get(1)).toBe(60001);
    expect(t.byDepartment.get(2)).toBe(1500);
    expect(t.byCategory.get("MON")).toBe(11500);
    expect(t.subtotal).toBe(61501);
    expect(t.contingency).toBe(6150.1);
    expect(t.grandTotal).toBe(67651.1);
    expect(t.unpricedLines).toBe(1);
  });
});

describe("parseRatio", () => {
  it("accepts decimals, integers and fractions", () => {
    expect(parseRatio("0.5")).toBe(0.5);
    expect(parseRatio(" 2 ")).toBe(2);
    expect(parseRatio("1/100")).toBe(0.01);
    expect(parseRatio("1:4")).toBe(0.25);
    expect(parseRatio("0,25")).toBe(0.25);
  });
  it("rejects junk, negatives and division by zero", () => {
    expect(parseRatio("")).toBeNull();
    expect(parseRatio("abc")).toBeNull();
    expect(parseRatio("-1")).toBeNull();
    expect(parseRatio("1/0")).toBeNull();
  });
});

describe("device search", () => {
  const idx = indexDevices([
    { id: 1, code: "LIF-VEN-ICU", name: "Ventilator, ICU", categoryName: "Life support & critical care", groupName: "Ventilators" },
    { id: 2, code: "LIF-VEN-TRN", name: "Ventilator, transport", categoryName: "Life support & critical care", groupName: "Ventilators" },
    { id: 3, code: "MON-PAT-HIGH", name: "Patient monitor, high acuity", categoryName: "Patient monitoring & diagnostics", groupName: "Patient monitors" },
    { id: 4, code: "INF-PMP-SYR", name: "Syringe pump", categoryName: "Infusion & drug delivery", groupName: "Infusion pumps" },
    ...Array.from({ length: 640 }, (_, i) => ({ id: 100 + i, code: `GEN-${i}`, name: `Generic device ${i}`, categoryName: "Other" })),
  ]);
  it("matches every term across name, code, group and category", () => {
    expect(searchDevices(idx, "vent icu").results.map((d) => d.id)).toEqual([1]);
    expect(searchDevices(idx, "infusion").results.map((d) => d.id)).toEqual([4]);
    expect(searchDevices(idx, "nothing-like-this").total).toBe(0);
  });
  it("ranks code prefix first, then name prefix", () => {
    expect(searchDevices(idx, "lif-ven").results.map((d) => d.id)).toEqual([1, 2]);
    expect(searchDevices(idx, "monitor").results[0].id).toBe(3);
  });
  it("caps results but reports the total", () => {
    const r = searchDevices(idx, "generic");
    expect(r.results).toHaveLength(50);
    expect(r.total).toBe(640);
    expect(searchDevices(idx, "").total).toBe(644);
  });
});

describe("approximate reciprocal ratios (regression)", () => {
  // Ratios are seeded as 8-decimal approximations; 1/30 → 0.03333333.
  it("1/30 per bed × 300 beds is exactly 10 under every rounding mode", () => {
    for (const r of [1 / 30, 0.03333333, Math.fround(1 / 30)]) {
      expect(applyRounding(300 * r, "CEIL")).toBe(10);
      expect(applyRounding(300 * r, "FLOOR")).toBe(10);
      expect(applyRounding(300 * r, "ROUND")).toBe(10);
    }
  });
  it("holds at large scale and for other reciprocals", () => {
    expect(applyRounding(30000 * 0.03333333, "FLOOR")).toBe(1000);
    expect(applyRounding(6 * 0.16666667, "CEIL")).toBe(1);
    expect(applyRounding(12 * 0.16666667, "FLOOR")).toBe(2);
  });
  it("still rounds genuine fractions", () => {
    expect(applyRounding(10.4, "CEIL")).toBe(11);
    expect(applyRounding(10.6, "FLOOR")).toBe(10);
    expect(applyRounding(2.5, "ROUND")).toBe(3);
  });
});

describe("hospital-scale rules are placed once per BOQ (regression)", () => {
  const rules: RuleInput[] = [
    rule({ id: 101, departmentTypeCode: "CSSD", deviceTypeId: 50, basis: "PER_HOSPITAL_BEDS", ratio: 0.01, minQty: 2 }),
    rule({ id: 102, departmentTypeCode: "CSSD", deviceTypeId: 51, basis: "FIXED", ratio: 4 }),
    rule({ id: 103, departmentTypeCode: "CSSD", deviceTypeId: 52, basis: "PER_DEPARTMENT", ratio: 1 }),
    rule({ id: 104, departmentTypeCode: "CSSD", deviceTypeId: 53, basis: "PER_ROOM", ratio: 1 }),
  ];
  const two = [
    dept({ id: 1, departmentTypeCode: "CSSD", label: "Central sterile services", beds: 0, rooms: 3 }),
    dept({ id: 2, departmentTypeCode: "CSSD", label: "Theatre sterile supply", beds: 0, rooms: 1 }),
  ];
  const lines = generateLines({ rules, departments: two, totalHospitalBeds: 84, includeTiers: ["ESSENTIAL"] });

  it("puts PER_HOSPITAL_BEDS and FIXED lines once, on the main (largest) department of the type", () => {
    expect(lines.filter((l) => l.ruleId === 101)).toEqual([expect.objectContaining({ boqDepartmentId: 1, calculatedQty: 2 })]);
    expect(lines.filter((l) => l.ruleId === 102)).toEqual([expect.objectContaining({ boqDepartmentId: 1, calculatedQty: 4 })]);
    expect(lines.find((l) => l.ruleId === 101)!.explanation).toMatch(/hospital-wide quantity, listed once/);
  });
  it("still applies per-department and per-room rules to each department", () => {
    expect(lines.filter((l) => l.ruleId === 103).map((l) => l.boqDepartmentId)).toEqual([1, 2]);
    expect(lines.filter((l) => l.ruleId === 104).map((l) => l.calculatedQty)).toEqual([3, 1]);
  });
  it("does not multiply hospital-scale quantities by instances", () => {
    const one = generateLines({ rules, departments: [dept({ id: 9, departmentTypeCode: "CSSD", beds: 0, rooms: 2, instances: 3 })], totalHospitalBeds: 300, includeTiers: ["ESSENTIAL"] });
    expect(one.find((l) => l.ruleId === 101)!.calculatedQty).toBe(3);   // 300 × 0.01, not × 3 instances
    expect(one.find((l) => l.ruleId === 102)!.calculatedQty).toBe(4);
    expect(one.find((l) => l.ruleId === 103)!.calculatedQty).toBe(3);   // per department × 3 instances
  });
  it("prefers the larger department even when it is listed second", () => {
    const swapped = generateLines({ rules, departments: [two[1], two[0]], totalHospitalBeds: 84, includeTiers: ["ESSENTIAL"] });
    expect(swapped.filter((l) => l.ruleId === 101).map((l) => l.boqDepartmentId)).toEqual([1]);
  });
});

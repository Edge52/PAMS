import { describe, expect, it } from "vitest";
import { compareCounts, compareWithGuideline, guidelineCode, ruleNote, validateGuideline, validateGuidelineRow, type GuidelineLookups } from "./guideline";
import type { RuleInput } from "./engine";

const lk: GuidelineLookups = {
  departmentTypes: new Map([["icu", "ICU"], ["intensive care unit", "ICU"], ["or", "OR"]]),
  deviceTypes: new Map([["mon-pat-high", { id: 1, code: "MON-PAT-HIGH", level: 3 }], ["ventilator, icu", { id: 2, code: "VEN-ICU", level: 3 }],
    ["ven-icu", { id: 2, code: "VEN-ICU", level: 3 }], ["mon", { id: 9, code: "MON", level: 1 }], ["def", { id: 3, code: "DEF", level: 3 }]]),
};

describe("guideline template rows (wave 41)", () => {
  it("reads a row by codes or names", () => {
    const r = validateGuidelineRow(2, { departmentType: "Intensive care unit", deviceType: "Ventilator, ICU", perBed: 0.5, roomType: "Bed space", version: "2025" }, lk);
    expect(r.errors).toEqual([]);
    expect(r.rule).toMatchObject({ departmentTypeCode: "ICU", deviceTypeId: 2, basis: "PER_BED", ratio: 0.5, roomType: "Bed space", version: "2025" });
  });
  it("says what is wrong", () => {
    expect(validateGuidelineRow(3, { departmentType: "Lab", deviceType: "MON-PAT-HIGH", perBed: 1 }, lk).errors[0]).toMatch(/Lab/);
    expect(validateGuidelineRow(3, { departmentType: "ICU", deviceType: "MON", perBed: 1 }, lk).errors[0]).toMatch(/category/);
    expect(validateGuidelineRow(3, { departmentType: "ICU", deviceType: "DEF" }, lk).errors[0]).toMatch(/Fill the quantity/);
    expect(validateGuidelineRow(3, { departmentType: "ICU", deviceType: "DEF", perBed: 1, perRoom: 1 }, lk).errors[0]).toMatch(/only one/);
    expect(validateGuidelineRow(3, { departmentType: "ICU", deviceType: "DEF", perRoom: -1 }, lk).errors[0]).toMatch(/at least 0/);
  });
  it("adds up room types for the same device and refuses a second basis or version", () => {
    const { rows, rules, version } = validateGuideline([
      { rowNumber: 2, cells: { departmentType: "ICU", deviceType: "DEF", perRoom: 1, roomType: "Bed bay", version: "2025" } },
      { rowNumber: 3, cells: { departmentType: "ICU", deviceType: "DEF", perRoom: 0.5, roomType: "Isolation", version: "2025" } },
      { rowNumber: 4, cells: { departmentType: "ICU", deviceType: "DEF", perBed: 1, version: "2025" } },
      { rowNumber: 5, cells: { departmentType: "OR", deviceType: "DEF", perRoom: 1, version: "2024" } },
    ], lk);
    expect(version).toBe("2025");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ ratio: 1.5, roomType: "Bed bay; Isolation" });
    expect(rows[2].errors[0]).toMatch(/per room/);
    expect(rows[3].errors[0]).toMatch(/same version/);
  });
  it("makes the set code and the rule note", () => {
    expect(guidelineCode("2025 v1.2")).toBe("NATGUIDE-2025-V1.2");
    expect(guidelineCode(null)).toBe("NATGUIDE");
    expect(ruleNote({ roomType: "Bed bay", notes: "At every bed" })).toBe("Room: Bed bay. At every bed");
  });
});

describe("this BOQ vs the guideline", () => {
  const rule = (o: Partial<RuleInput>): RuleInput => ({ id: 1, departmentTypeCode: "ICU", deviceTypeId: 1, basis: "PER_BED", ratio: 1, minQty: 0, maxQty: null, rounding: "CEIL", tier: "ESSENTIAL", ...o });
  const rules = [rule({ deviceTypeId: 1 }), rule({ id: 2, deviceTypeId: 2, ratio: 0.5 }), rule({ id: 3, deviceTypeId: 3, basis: "PER_DEPARTMENT", ratio: 1 }), rule({ id: 4, departmentTypeCode: "OR", deviceTypeId: 4, basis: "PER_ROOM", ratio: 1 })];
  const depts = [
    { id: 10, departmentTypeCode: "ICU", label: "Adult ICU", beds: 12, rooms: 12, instances: 1 },
    { id: 11, departmentTypeCode: "WARD", label: "Ward", beds: 30, rooms: 15, instances: 1 },
    { id: 12, departmentTypeCode: "OR", label: "Theatres", beds: 0, rooms: 4, instances: 2 },
  ];
  it("finds missing devices and lower, higher and equal quantities", () => {
    const lines = [
      { boqDepartmentId: 10, deviceTypeId: 1, quantity: 12 },  // same
      { boqDepartmentId: 10, deviceTypeId: 2, quantity: 4 },   // lower than 6
      { boqDepartmentId: 10, deviceTypeId: 5, quantity: 2 },   // not in the guideline: higher
      { boqDepartmentId: 11, deviceTypeId: 1, quantity: 30 },  // ward not covered: left out
      { boqDepartmentId: 12, deviceTypeId: 4, quantity: 9 },   // 4 rooms × 2 instances = 8: higher
    ];
    const rows = compareWithGuideline(depts, lines, rules, 0);
    expect(rows.map((r) => [r.departmentLabel, r.deviceTypeId, r.guideline, r.boq, r.kind])).toEqual([
      ["Adult ICU", 3, 1, 0, "missing"],
      ["Adult ICU", 2, 6, 4, "lower"],
      ["Adult ICU", 5, 0, 2, "higher"],
      ["Theatres", 4, 8, 9, "higher"],
      ["Adult ICU", 1, 12, 12, "same"],
    ]);
    expect(compareCounts(rows)).toEqual({ missing: 1, lower: 1, higher: 2, same: 1 });
    expect(rows.find((r) => r.deviceTypeId === 5)!.explanation).toMatch(/Not in the guideline/);
  });
  it("adds lines of the same device in one department", () => {
    const rows = compareWithGuideline([depts[0]], [{ boqDepartmentId: 10, deviceTypeId: 1, quantity: 5 }, { boqDepartmentId: 10, deviceTypeId: 1, quantity: 7 }], [rules[0]], 0);
    expect(rows).toEqual([expect.objectContaining({ boq: 12, guideline: 12, kind: "same" })]);
  });
});

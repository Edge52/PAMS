import { describe, expect, it } from "vitest";
import {
  blankResults, checklistSummary, defaultChecklist, effectiveChecklist, fillChecklist, formatChecklist, parseChecklist, rangeLabel,
} from "./checklists";
import { annualCostPerAsset, contractState, coverLabel, coverOn } from "./contracts";

describe("default checklists", () => {
  it("adds group-specific lines and electrical safety", () => {
    const vent = defaultChecklist(["LIF-VEN-ICU", "LIF-VEN", "LIF"]).map((i) => i.text);
    expect(vent).toContain("Delivered tidal volume at 500 mL setting");
    expect(vent).toContain("Protective earth resistance");
    expect(vent.at(-1)).toMatch(/Cleaned and disinfected/);
  });
  it("prefers the longest matching prefix", () => {
    const fridge = defaultChecklist(["LAB-STO-FRG", "LAB-STO", "LAB"]).map((i) => i.text);
    expect(fridge).toContain("Cabinet temperature at set point");
    expect(fridge).not.toContain("Quality control run within limits");
  });
  it("skips electrical safety for furniture and adds calibration when required", () => {
    const bed = defaultChecklist(["FUR-BED-ELC", "FUR-BED", "FUR"]).map((i) => i.text);
    expect(bed).not.toContain("Protective earth resistance");
    expect(defaultChecklist(["XYZ"], { requiresCalibration: true }).some((i) => i.text.startsWith("Calibration"))).toBe(true);
  });
  it("has no duplicate lines", () => {
    const l = defaultChecklist(["MON-PAT-HIGH", "MON-PAT", "MON"]).map((i) => i.text);
    expect(new Set(l).size).toBe(l.length);
  });
  it("inherits from type, then group, then category", () => {
    const t = [{ text: "own" }], g = [{ text: "group" }], c = [{ text: "cat" }];
    expect(effectiveChecklist(t, g, c, () => []).source).toBe("type");
    expect(effectiveChecklist([], g, c, () => []).items).toEqual(g);
    expect(effectiveChecklist(null, null, c, () => []).source).toBe("category");
    expect(effectiveChecklist(null, null, null, () => [{ text: "d" }]).source).toBe("default");
  });
});

describe("checklist text form", () => {
  it("round-trips checks and measurements", () => {
    const text = "Visual check\nLeakage current | µA | | 500\nSpO2 | % | 96 | 100";
    const { items, errors } = parseChecklist(text);
    expect(errors).toEqual([]);
    expect(items).toEqual([{ text: "Visual check" }, { text: "Leakage current", unit: "µA", max: 500 }, { text: "SpO2", unit: "%", min: 96, max: 100 }]);
    expect(parseChecklist(formatChecklist(items)).items).toEqual(items);
  });
  it("reports bad numbers and inverted ranges", () => {
    expect(parseChecklist("A | V | x | 5").errors[0]).toMatch(/not a number/);
    expect(parseChecklist("A | V | 9 | 5").errors[0]).toMatch(/minimum is above/);
    expect(parseChecklist(" | V").errors[0]).toMatch(/needs a description/);
  });
  it("labels ranges", () => {
    expect(rangeLabel({ text: "a", unit: "%", min: 96, max: 100 })).toBe("96–100 %");
    expect(rangeLabel({ text: "a", unit: "µA", max: 500 })).toBe("≤ 500 µA");
    expect(rangeLabel({ text: "a", unit: "kPa", min: -80 })).toBe("≥ -80 kPa");
  });
});

describe("filling a checklist", () => {
  const sheet = blankResults([{ text: "Visual" }, { text: "SpO2", unit: "%", min: 96, max: 100 }, { text: "Leakage", unit: "µA", max: 500 }]);
  it("passes in-range readings and fails out-of-range ones whatever was ticked", () => {
    const r = fillChecklist(sheet, [{ result: "PASS" }, { value: "98" }, { result: "PASS", value: "640" }]);
    expect(r.problems).toEqual([]);
    expect(r.results.map((x) => x.result)).toEqual(["PASS", "PASS", "FAIL"]);
    expect(r.failed).toBe(1);
    expect(checklistSummary(r.results)).toMatchObject({ total: 3, pass: 2, fail: 1, open: 0 });
  });
  it("blocks completion when lines are unanswered", () => {
    const r = fillChecklist(sheet, [{}, { value: "" }, { result: "NA" }]);
    expect(r.problems).toEqual(['Answer "Visual".', 'Enter the reading for "SpO2".']);
  });
  it("accepts a failed measurement without a reading and comma decimals", () => {
    const r = fillChecklist(sheet, [{ result: "FAIL", note: "cracked" }, { result: "FAIL" }, { value: "0,2" }]);
    expect(r.problems).toEqual([]);
    expect(r.results[2]).toMatchObject({ result: "PASS", value: 0.2 });
    expect(r.results[0].note).toBe("cracked");
  });
});

describe("contracts and cover", () => {
  const c = { id: 1, number: "SC-2026-0001", type: "FULL_SERVICE", startDate: "2026-01-01", endDate: "2026-12-31", supplierName: "Delta" };
  it("knows a contract's state", () => {
    expect(contractState(c, "2025-12-01").state).toBe("FUTURE");
    expect(contractState(c, "2026-06-01").state).toBe("ACTIVE");
    expect(contractState(c, "2026-11-15")).toEqual({ state: "EXPIRING", days: 46 });
    expect(contractState(c, "2027-01-02").state).toBe("EXPIRED");
  });
  it("prefers warranty, then full service, then the longest running contract", () => {
    expect(coverOn({ warrantyEnd: "2026-08-01" }, [c], "2026-07-01")).toEqual({ kind: "WARRANTY", until: "2026-08-01" });
    expect(coverOn({ warrantyEnd: "2026-08-01" }, [c], "2026-09-01")).toMatchObject({ kind: "CONTRACT", contract: { id: 1 } });
    const parts = { ...c, id: 2, type: "PARTS_ONLY", endDate: "2027-06-30" };
    expect(coverOn({}, [parts, c], "2026-09-01")).toMatchObject({ contract: { id: 1 } });
    expect(coverOn({}, [parts, c], "2027-02-01")).toMatchObject({ contract: { id: 2 } });
    expect(coverOn({}, [c], "2027-02-01")).toEqual({ kind: "NONE" });
    expect(coverLabel(coverOn({}, [c], "2026-09-01"))).toBe("Covered by SC-2026-0001 with Delta until 2026-12-31");
  });
  it("spreads the contract value per asset per year", () => {
    expect(annualCostPerAsset(120000, "2026-01-01", "2027-12-31", 10)).toBeCloseTo(6000, -1);
    expect(annualCostPerAsset(null, "2026-01-01", "2026-12-31", 3)).toBeNull();
  });
});

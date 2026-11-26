import { describe, expect, it } from "vitest";
import {
  dueState, EXAMPLE_TEMPLATES, expectedRuns, failureTitle, itemsText, judgeRun, limitText, MODALITIES, modalityOf, monthFigures, parseItems, periodStart,
  reviewMonths, trend, weekStart,
} from "./imaging-qc";

describe("routine imaging QC (wave 40)", () => {
  it("knows the modality of a scanner type", () => {
    expect(modalityOf("IMG-CT-64")).toBe("CT");
    expect(modalityOf("IMG-MRI-15T")).toBe("MRI");
    expect(modalityOf("IMG-XR-DR")).toBe("XRAY");
    expect(modalityOf("IMG-XR-MDR")).toBe("XRAY");
    expect(modalityOf("IMG-XR-CARM")).toBe("FLUORO");
    expect(modalityOf("IMG-XR-FLUORO")).toBe("FLUORO");
    expect(modalityOf("IMG-MAM-DIG")).toBe("MAMMO");
    expect(modalityOf("IMG-MAM-ABUS")).toBe("US");
    expect(modalityOf("IMG-US-GEN")).toBe("US");
    expect(modalityOf("IMG-XR-CR")).toBeNull();
    expect(modalityOf("MON-PAT-HIGH")).toBeNull();
  });
  it("has example templates for every modality, all marked as examples", () => {
    for (const m of MODALITIES) expect(EXAMPLE_TEMPLATES.some((t) => t.modality === m)).toBe(true);
    for (const t of EXAMPLE_TEMPLATES) expect(t.name).toMatch(/\(example\)$/);
    const ct = EXAMPLE_TEMPLATES.find((t) => t.modality === "CT" && t.frequency === "DAILY")!;
    expect(ct.items.find((i) => i.label.startsWith("Water CT number"))).toMatchObject({ min: -4, max: 4, unit: "HU" });
  });
  it("reads and writes the template text format", () => {
    const { items, problems } = parseItems("Water CT number | HU | -4 | 4\nImage free of artefacts\nNoise | HU |  | 6\nCentre frequency | MHz | |");
    expect(problems).toEqual([]);
    expect(items).toEqual([
      { label: "Water CT number", kind: "VALUE", unit: "HU", min: -4, max: 4 },
      { label: "Image free of artefacts", kind: "PASS_FAIL" },
      { label: "Noise", kind: "VALUE", unit: "HU", min: null, max: 6 },
      { label: "Centre frequency", kind: "VALUE", unit: "MHz", min: null, max: null },
    ]);
    expect(parseItems(itemsText(items)).items).toEqual(items);
    expect(parseItems("A | HU | 5 | 1").problems[0]).toContain("lower limit");
    expect(parseItems("A | HU | x").problems[0]).toContain("numbers");
    expect(parseItems("").problems).toEqual(["Add at least one item."]);
    expect(limitText(items[0])).toBe("-4 to 4 HU");
    expect(limitText(items[2])).toBe("at most 6 HU");
  });
  it("judges a run against the limits", () => {
    const items = parseItems("Water CT number | HU | -4 | 4\nArtefacts absent").items;
    expect(judgeRun(items, [{ value: "2.5" }, { result: "PASS" }])).toMatchObject({ passed: true, failed: [], problems: [] });
    const bad = judgeRun(items, [{ value: "-4.5" }, { result: "PASS" }]);
    expect(bad.passed).toBe(false);
    expect(bad.failed).toEqual(["Water CT number: -4.5 HU (limit -4 to 4 HU)"]);
    expect(judgeRun(items, [{ value: "4" }, { result: "FAIL" }]).failed).toEqual(["Artefacts absent"]);
    expect(judgeRun(items, [{ value: "" }, {}]).problems).toHaveLength(2);
    expect(judgeRun(items, [{ result: "NA" }, { result: "PASS" }]).passed).toBe(true);
  });
  it("works out periods and what is due", () => {
    expect(weekStart("2026-11-26")).toBe("2026-11-23"); // a Thursday → Monday
    expect(periodStart("MONTHLY", "2026-11-26")).toBe("2026-11-01");
    const today = "2026-11-26";
    expect(dueState("DAILY", "2026-11-26", today)).toBe("done");
    expect(dueState("DAILY", "2026-11-25", today)).toBe("due");
    expect(dueState("DAILY", "2026-11-20", today)).toBe("overdue");
    expect(dueState("WEEKLY", "2026-11-23", today)).toBe("done");
    expect(dueState("WEEKLY", "2026-11-17", today)).toBe("due");
    expect(dueState("WEEKLY", "2026-11-10", today)).toBe("overdue");
    expect(dueState("MONTHLY", "2026-10-05", today)).toBe("due");
    expect(dueState("MONTHLY", "2026-09-30", today)).toBe("overdue");
    expect(dueState("MONTHLY", null, today)).toBe("never");
  });
  it("counts a month's runs, failures and missed periods", () => {
    expect(expectedRuns("MONTHLY", "2026-11")).toBe(1);
    expect(expectedRuns("WEEKLY", "2026-11")).toBe(6); // 1 Nov is a Sunday: weeks of 26 Oct … 30 Nov
    expect(expectedRuns("DAILY", "2026-11")).toBe(26); // 30 days less 4 Fridays
    expect(expectedRuns("DAILY", "2026-11", "2026-11-03")).toBe(3);
    const runs = [{ performedOn: "2026-11-02", passed: true }, { performedOn: "2026-11-09", passed: false }, { performedOn: "2026-11-10", passed: true }];
    expect(monthFigures("WEEKLY", "2026-11", runs, "2026-12-01")).toEqual({ runs: 3, failed: 1, missed: 4 });
  });
  it("gives the trend of a measured item and the review months", () => {
    const items = parseItems("Water CT number | HU | -4 | 4").items;
    const t = trend([
      { performedOn: "2026-11-02", items, answers: [{ label: "Water CT number", result: "PASS", value: 1 }] },
      { performedOn: "2026-11-01", items, answers: [{ label: "Water CT number", result: "FAIL", value: 5 }] },
      { performedOn: "2026-11-03", items, answers: [{ label: "Water CT number", result: "NA", value: null }] },
    ], "Water CT number");
    expect(t).toEqual({ points: [{ on: "2026-11-01", value: 5, ok: false }, { on: "2026-11-02", value: 1, ok: true }], min: -4, max: 4, unit: "HU" });
    expect(reviewMonths("2026-01-15")).toEqual(["2026-01", "2025-12", "2025-11"]);
    expect(failureTitle("CT daily water phantom (example)", ["a", "b", "c"])).toBe("QC failed: CT daily water phantom — a; b and 1 more");
  });
});

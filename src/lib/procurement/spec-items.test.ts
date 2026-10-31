import { describe, expect, it } from "vitest";
import { initialSpecItems, planSpecItems } from "./spec-items";

describe("initialSpecItems", () => {
  it("prefers the device type template", () => {
    const r = initialSpecItems("XYZ-NEW", [{ name: "Screen size", unit: "in", hint: "≥ 15" }, { name: "Modes", unit: "text" }], false);
    expect(r.source).toBe("template");
    expect(r.items).toEqual([
      { section: "Technical", parameter: "Screen size", requirement: "≥ 15", unit: "in", mandatory: true, weight: 1 },
      { section: "Technical", parameter: "Modes", requirement: "To be specified", unit: "", mandatory: true, weight: 1 },
    ]);
  });
  it("fills template parameters with library requirements when names match", () => {
    const r = initialSpecItems("IMG-CT-128", [{ name: "Rotation time", unit: "s" }], false);
    expect(r.items[0].requirement).toBe("≤ 0.35 s");
    expect(r.items[0].section).toBe("Gantry");
  });
  it("falls back to the starter library, then general conditions only", () => {
    expect(initialSpecItems("IMG-CT-128", null).source).toBe("library");
    const g = initialSpecItems("XYZ-UNKNOWN", []);
    expect(g.source).toBe("general");
    expect(g.items.every((i) => i.section === "General conditions")).toBe(true);
  });
});

describe("planSpecItems", () => {
  it("updates kept ids, inserts new rows, removes missing ids and renumbers", () => {
    const p = planSpecItems([1, 2, 3], [
      { id: 2, parameter: "B", requirement: "x", weight: 1, mandatory: true },
      { parameter: "New", requirement: "y", weight: "2" },
      { id: 99, parameter: "Foreign id", requirement: "z", weight: 1 },
      { parameter: "", requirement: "" },
    ]);
    expect(p.errors).toEqual([]);
    expect(p.update.map((u) => [u.id, u.sortOrder])).toEqual([[2, 10]]);
    expect(p.insert.map((i) => [i.parameter, i.sortOrder, i.weight])).toEqual([["New", 20, 2], ["Foreign id", 30, 1]]);
    expect(p.remove).toEqual([1, 3]);
  });
  it("reports missing fields and bad weights in plain language", () => {
    const p = planSpecItems([], [{ parameter: "A", requirement: "" }, { parameter: "", requirement: "r" }, { parameter: "W", requirement: "r", weight: -1 }]);
    expect(p.errors).toHaveLength(3);
  });
  it("rejects an empty specification and garbage input", () => {
    expect(planSpecItems([1], []).errors).toEqual(["A specification needs at least one parameter."]);
    expect(planSpecItems([1], "nope").errors).toHaveLength(1);
  });
  it("does not let the same id be updated twice", () => {
    const p = planSpecItems([5], [{ id: 5, parameter: "A", requirement: "r", weight: 1 }, { id: 5, parameter: "B", requirement: "r", weight: 1 }]);
    expect(p.update).toHaveLength(1);
    expect(p.insert).toHaveLength(1);
  });
});

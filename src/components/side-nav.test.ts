import { describe, expect, it } from "vitest";
import { orderSections } from "./side-nav";

describe("menu order by role (wave 19)", () => {
  const groups = ["Overview", "Hospital", "Planning", "Procurement", "Assets", "Asset management", "Administration"].map((title) => ({ title }));
  it("puts each role's own work first and keeps the rest in their usual order", () => {
    expect(orderSections(groups, "TECHNICIAN").map((g) => g.title)).toEqual(["Overview", "Assets", "Asset management", "Hospital", "Planning", "Procurement", "Administration"]);
    expect(orderSections(groups, "PROCUREMENT").map((g) => g.title).slice(0, 3)).toEqual(["Overview", "Procurement", "Planning"]);
    expect(orderSections(groups, null).map((g) => g.title)).toEqual(groups.map((g) => g.title));
  });
});

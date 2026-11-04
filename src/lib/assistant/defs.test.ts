import { describe, expect, it } from "vitest";
import { clip, toolsFor, trimHistory } from "./defs";

describe("assistant tools", () => {
  it("shows a role only the tools it may use", () => {
    expect(toolsFor("ADMIN").map((t) => t.name)).toContain("budget_status");
    expect(toolsFor("TECHNICIAN").some((t) => t.need === "procurement.view")).toBe(true); // VIEW includes procurement.view
    expect(toolsFor("NOBODY")).toEqual([]);
  });
  it("cuts long results", () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ i, name: "x".repeat(40) }));
    const s = clip(big, 5000);
    expect(s.length).toBeLessThanOrEqual(5000 + 10);
    expect(JSON.parse(s).of).toBe(2000);
  });
  it("starts the history with the user", () => {
    expect(trimHistory([{ role: "assistant", text: "hi" }, { role: "user", text: "q" }, { role: "assistant", text: " " }])).toEqual([{ role: "user", text: "q" }]);
  });
});

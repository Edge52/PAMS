import { describe, expect, it } from "vitest";
import { decodeView, describeView, encodeView, type ViewState } from "./view-state";

const v: ViewState = {
  cam: [120.456, 80, -33.21], tgt: [60, 10.04, 40], floor: 7, layer: "faults", scope: "department", explode: 2.25,
  statuses: ["OUT_OF_SERVICE", "UNDER_MAINTENANCE"], cats: ["LIF", "MON"],
};

describe("view links", () => {
  it("round-trips a view (numbers to 0.1)", () => {
    const s = encodeView(v);
    expect(s).not.toMatch(/[ ?&#/]/);
    expect(decodeView(s)).toEqual({ ...v, cam: [120.5, 80, -33.2], tgt: [60, 10, 40], explode: 2.3 });
  });
  it("handles the whole building and no filters", () => {
    const w = decodeView(encodeView({ ...v, floor: null, statuses: [], cats: [], layer: "department", scope: "room" }))!;
    expect(w).toMatchObject({ floor: null, statuses: [], cats: [], layer: "department", scope: "room" });
  });
  it("rejects tampered or broken links", () => {
    expect(decodeView(null)).toBeNull();
    expect(decodeView("garbage")).toBeNull();
    expect(decodeView(encodeView(v).replace("faults", "hack"))).toBeNull();
    expect(decodeView(encodeView({ ...v, explode: 9 }))).toBeNull();
    expect(decodeView(encodeView(v).replace("120.5", "NaN"))).toBeNull();
    expect(decodeView(encodeView({ ...v, floor: -3 }))).toBeNull();
    expect(decodeView("x".repeat(3000))).toBeNull();
  });
  it("drops filter codes that aren't codes", () => {
    const s = encodeView({ ...v, cats: ["LIF", "<script>"] });
    expect(decodeView(s)!.cats).toEqual(["LIF"]);
  });
  it("describes a view", () => {
    expect(describeView(v, "Fourth floor", "Open faults")).toBe("Fourth floor · Open faults · 2 status filters · 2 equipment types");
    expect(describeView({ layer: "department", statuses: [], cats: [] }, null, "Departments")).toBe("Whole building");
  });
});

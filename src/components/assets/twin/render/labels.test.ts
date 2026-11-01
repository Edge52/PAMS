import { describe, expect, it } from "vitest";
import { layoutLabels, wrapName } from "./labels";

describe("wrapName", () => {
  it("keeps short names on one line and splits long ones near the middle", () => {
    expect(wrapName("ICU (3)")).toEqual(["ICU (3)"]);
    expect(wrapName("MED/SURG DOUBLE ROOM (4)")).toEqual(["MED/SURG DOUBLE", "ROOM (4)"]);
  });
});

describe("layoutLabels", () => {
  it("places the bigger room's label and drops one that would overlap it", () => {
    const out = layoutLabels([
      { id: 1, text: "Waiting area", x: 200, y: 200, area: 40000, room: 200 },
      { id: 2, text: "Store", x: 205, y: 202, area: 900, room: 30 },
      { id: 3, text: "ICU (2)", x: 600, y: 300, area: 20000, room: 140 },
    ], 1000, 800);
    expect(out.map((l) => l.id)).toEqual([1, 3]);
    expect(out[0].lines).toEqual(["WAITING AREA"]);
  });
  it("leaves out labels that would run off the image or far beyond a tiny room", () => {
    const out = layoutLabels([
      { id: 1, text: "Corner", x: 3, y: 3, area: 5000, room: 80 },
      { id: 2, text: "A very long room name indeed for a cupboard", x: 400, y: 400, area: 100, room: 10 },
    ], 800, 800);
    expect(out).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { scaleBar, viewChanged, type ViewState } from "./hud-map";

describe("scale bar (wave 22b)", () => {
  it("picks a round length close to 90 px", () => {
    expect(scaleBar(0.1)).toEqual({ metres: 10, px: 100 });
    expect(scaleBar(0.02).metres).toBe(2);
    expect(scaleBar(1).metres).toBe(100);
    const far = scaleBar(4); expect(far.metres).toBe(500); expect(far.px).toBe(125);
  });
});

describe("map redraws only when the view moves (A21)", () => {
  const v: ViewState = { metresPerPixel: 0.1, target: { x: 10, z: 20 }, camera: { x: 40, z: 60 }, floorId: 3 };
  it("ignores an idle camera and catches real moves", () => {
    expect(viewChanged(null, v)).toBe(true);
    expect(viewChanged(v, { ...v, target: { ...v.target } })).toBe(false);
    expect(viewChanged(v, { ...v, target: { x: 10.01, z: 20 } })).toBe(false);
    expect(viewChanged(v, { ...v, target: { x: 11, z: 20 } })).toBe(true);
    expect(viewChanged(v, { ...v, camera: { x: 40, z: 61 } })).toBe(true);
    expect(viewChanged(v, { ...v, floorId: 4 })).toBe(true);
    expect(viewChanged(v, { ...v, metresPerPixel: 0.12 })).toBe(true);
  });
});

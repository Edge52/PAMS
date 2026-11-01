import { describe, expect, it } from "vitest";
import { close, rasterise, rectangles, wallMass } from "./walls";

const covered = (rects: { x0: number; z0: number; x1: number; z1: number }[], x: number, z: number) =>
  rects.some((r) => x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1);

describe("wall mass", () => {
  const bounds = { x0: 0, x1: 10, z0: 0, z1: 10 };
  it("fills between the two faces of a wall", () => {
    // A 0.2 m thick wall along z = 5 (both faces), 10 m long.
    const rects = wallMass([0, 5, 10, 5, 0, 5.2, 10, 5.2], bounds, 0.05, 0.2);
    expect(covered(rects, 5, 5.1)).toBe(true);
    expect(covered(rects, 5, 6)).toBe(false);
  });
  it("keeps a door opening open", () => {
    // Two wall pieces with a 1 m gap between x = 4.5 and 5.5.
    const rects = wallMass([0, 5, 4.5, 5, 0, 5.2, 4.5, 5.2, 5.5, 5, 10, 5, 5.5, 5.2, 10, 5.2], bounds, 0.05, 0.2);
    expect(covered(rects, 5, 5.1)).toBe(false);
    expect(covered(rects, 3, 5.1)).toBe(true);
  });
  it("merges identical runs into one rectangle", () => {
    const g = rasterise([], bounds, 1);
    for (let z = 2; z < 5; z++) for (let x = 3; x < 6; x++) g.data[z * g.w + x] = 1;
    const r = rectangles(close(g, 0 + 1));
    expect(r.length).toBe(1);
  });
});

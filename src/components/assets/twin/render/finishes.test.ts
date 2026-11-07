import { describe, expect, it } from "vitest";
import { finishPixels, fittingSpots } from "./finishes";

describe("photoreal finishes and fittings (wave 17, phase 9)", () => {
  it("draws each finish the same way every time, with grout, seams and planks", () => {
    const a = finishPixels("wet", 64), b = finishPixels("wet", 64);
    expect(a).toEqual(b);
    // A grout line is darker than the middle of a tile.
    expect(a[(0 * 64 + 10) * 4]).toBeLessThan(a[(10 * 64 + 10) * 4]);
    expect(finishPixels("wood", 64)).not.toEqual(finishPixels("vinyl", 64));
    expect(finishPixels("terrazzo", 32).length).toBe(32 * 32 * 4);
  });
  it("spaces light fittings over a room, off the walls", () => {
    const room: [number, number][] = [[0, 0], [7.2, 0], [7.2, 4.8], [0, 4.8]];
    const f = fittingSpots(room);
    expect(f.length).toBe(6);
    expect(f.every(([x, z]) => x > 0.6 && x < 6.6 && z > 0.6 && z < 4.2)).toBe(true);
    expect(fittingSpots([[0, 0], [1.5, 0], [1.5, 1.5], [0, 1.5]]).length).toBe(1);
  });
});

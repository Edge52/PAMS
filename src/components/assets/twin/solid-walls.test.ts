import { describe, expect, it } from "vitest";
import { shellOf, toMetres, wallHeights } from "./solid-walls";

/** A 6 × 4 m room with 0.2 m walls (both faces drawn), a 1 m door gap in the bottom wall and a 2 m window in the top. */
function room() {
  const walls: number[] = [];
  const both = (x1: number, z1: number, x2: number, z2: number, dx: number, dz: number) => walls.push(x1, z1, x2, z2, x1 + dx, z1 + dz, x2 + dx, z2 + dz);
  both(0, 0, 2.5, 0, 0, 0.2); both(3.5, 0, 6, 0, 0, 0.2); // bottom wall with a gap from 2.5 to 3.5
  both(0, 4, 2, 4, 0, -0.2); both(4, 4, 6, 4, 0, -0.2);   // top wall with a window gap from 2 to 4
  both(0, 0, 0, 4, 0.2, 0); both(6, 0, 6, 4, -0.2, 0);    // sides
  const doors = [2.5, 0.1, 3.5, 0.1, 2.5, 0.1, 2.5, 1.1]; // door leaf and its frame line
  const glass = [2, 3.9, 4, 3.9];
  return { walls, doors, glass, b: { x0: 0, x1: 6, z0: 0, z1: 4 } };
}
const area = (rs: { x0: number; x1: number; z0: number; z1: number }[]) => rs.reduce((t, r) => t + (r.x1 - r.x0) * (r.z1 - r.z0), 0);

describe("solid walls (wave 16, phase 3)", () => {
  it("turns wall lines into solid boxes and puts a lintel over the door and a window in the glazing", () => {
    const { walls, doors, glass, b } = room();
    const sh = shellOf(walls, [], doors, glass, b);
    // Wall mass ≈ perimeter less the openings × 0.2 m (rasterised, so loose bounds).
    expect(area(sh.walls)).toBeGreaterThan(3); expect(area(sh.walls)).toBeLessThan(5.5);
    // The lintel spans the door gap (about 1 m × 0.2 m), between x 2.5 and 3.5 near z 0.
    expect(sh.lintels.length).toBeGreaterThan(0);
    const lx0 = Math.min(...sh.lintels.map((r) => r.x0)), lx1 = Math.max(...sh.lintels.map((r) => r.x1));
    expect(lx0).toBeGreaterThan(2.2); expect(lx1).toBeLessThan(3.8);
    expect(Math.max(...sh.lintels.map((r) => r.z1))).toBeLessThan(0.6);
    // No lintel over the window gap: there is no door there.
    expect(sh.lintels.every((r) => r.z0 < 1)).toBe(true);
    // The window sits in the top wall's gap.
    expect(sh.windows.length).toBeGreaterThan(0);
    expect(Math.min(...sh.windows.map((r) => r.z0))).toBeGreaterThan(3.5);
  });
  it("keeps only segments on the plan", () => {
    expect(toMetres([0, 0, 10, 0, 900, 900, 910, 900], 0.1, { x0: 0, x1: 10, z0: 0, z1: 10 })).toEqual([0, 0, 1, 0]);
  });
  it("sizes walls from floor to floor", () => {
    const h = wallHeights([{ id: 1, elevation: 0 }, { id: 2, elevation: 5 }, { id: 3, elevation: 9.5 }, { id: 4, elevation: -5 }]);
    expect(h.get(4)).toBe(4.65); expect(h.get(1)).toBe(4.65); expect(h.get(2)).toBe(4.15);
    expect(h.get(3)).toBe(4.15); // top floor: as the floor below
    expect(wallHeights([{ id: 9, elevation: 0 }]).get(9)).toBe(3.3);
  });
});

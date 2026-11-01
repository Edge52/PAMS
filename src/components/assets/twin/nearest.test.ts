import { describe, expect, it } from "vitest";
import { rankNearest, STOREY_COST_M } from "./nearest";

describe("nearest available", () => {
  const from = { floorId: 1, elevation: 0, x: 0, z: 0 };
  const cores = [{ floorId: 1, elevation: 0, x: 10, z: 0, kind: "lift" as const }, { floorId: 1, elevation: 0, x: -3, z: 0, kind: "stair" as const }];
  it("puts the same floor first, then other floors via the best core", () => {
    const r = rankNearest(from, [
      { id: 1, floorId: 2, elevation: 5, x: 10, z: 1 },
      { id: 2, floorId: 1, elevation: 0, x: 60, z: 80 },
      { id: 3, floorId: 1, elevation: 0, x: 3, z: 4 },
    ], cores);
    expect(r.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(r[0].distance).toBe(5);
    expect(r[2]).toMatchObject({ sameFloor: false, floors: 1 });
    expect(r[2].via?.kind).toBe("lift"); // 10 + 25 + 1 beats 3 + 40 + 13
    expect(r[2].distance).toBeCloseTo(10 + STOREY_COST_M + 1);
  });
  it("still ranks other floors when no core is drawn", () => {
    const r = rankNearest(from, [{ id: 1, floorId: 3, elevation: 10, x: 0, z: 0 }], []);
    expect(r[0]).toMatchObject({ via: null, floors: 2 });
  });
});

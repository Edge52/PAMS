import { describe, expect, it } from "vitest";
import { centroid, interiorPoint, latticeInside, pointInPolygon, polygonArea, rectPoly, spreadInRoom, wallsFromRooms, type Pt } from "./geometry";

const L: Pt[] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]]; // L-shaped room, centroid outside the bar

describe("polygon helpers", () => {
  it("point in polygon", () => {
    expect(pointInPolygon([10, 10], L)).toBe(true);
    expect(pointInPolygon([80, 80], L)).toBe(false);
  });
  it("area and centroid of a rectangle", () => {
    const r = rectPoly(10, 20, 40, 10);
    expect(polygonArea(r)).toBe(400);
    expect(centroid(r)).toEqual([30, 25]);
  });
  it("interior point is inside even when the centroid is not", () => {
    const c = centroid(L);
    const p = interiorPoint(L);
    expect(pointInPolygon(p, L)).toBe(true);
    expect(Number.isFinite(c[0])).toBe(true);
  });
});

describe("spreadInRoom", () => {
  it("puts a single device at the centre of a rectangle", () => {
    expect(spreadInRoom(rectPoly(0, 0, 40, 20), 1)).toEqual([[20, 10]]);
  });
  it("keeps every device inside an irregular room and spreads them out", () => {
    const pts = spreadInRoom(L, 9);
    expect(pts).toHaveLength(9);
    for (const p of pts) expect(pointInPolygon(p, L)).toBe(true);
    expect(new Set(pts.map((p) => p.join(","))).size).toBe(9);
  });
  it("still returns n points for a tiny room", () => {
    expect(spreadInRoom(rectPoly(0, 0, 1, 1), 5)).toHaveLength(5);
  });
  it("lattice points stay away from walls", () => {
    for (const p of latticeInside(rectPoly(0, 0, 10, 10), 4)) {
      expect(p[0]).toBeGreaterThan(0.5); expect(p[0]).toBeLessThan(9.5);
    }
  });
});

describe("wallsFromRooms", () => {
  it("emits a shared edge once", () => {
    const segs = wallsFromRooms([rectPoly(0, 0, 10, 10), rectPoly(10, 0, 10, 10)]);
    expect(segs.length / 4).toBe(7); // 4 + 4 edges, one shared
  });
});

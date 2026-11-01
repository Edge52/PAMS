import { describe, expect, it } from "vitest";
import { centroid, coreKind, floorLoadOrder, isSlow, outlineFromRooms, presetCamera, deviceKind, interiorPoint, latticeInside, pointInPolygon, polygonArea, rectPoly, spreadInRoom, wallsFromRooms, type Pt } from "./geometry";

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

describe("device kinds", () => {
  it("maps groups and categories to marker shapes", () => {
    expect(deviceKind("FUR-BED", "FUR")).toBe("bed");
    expect(deviceKind("LIF-VEN", "LIF")).toBe("ventilator");
    expect(deviceKind("LIF-DEF", "LIF")).toBe("monitor");
    expect(deviceKind("LIF-AIR", "LIF")).toBe("other");
    expect(deviceKind("INF-PMP", "INF")).toBe("pump");
    expect(deviceKind("IMG-CT", "IMG")).toBe("imaging");
    expect(deviceKind("OBG-FET", "OBG")).toBe("monitor");
    expect(deviceKind(null, "MON")).toBe("monitor");
    expect(deviceKind(null, null)).toBe("other");
  });
});

describe("vertical cores and loading", () => {
  it("reads stairs, lifts and shafts from room names", () => {
    expect(coreKind("Stair 3")).toBe("stair");
    expect(coreKind("ELEVATOR LOBBY")).toBe("lift");
    expect(coreKind("Parking Elevator Lobby")).toBe("lift");
    expect(coreKind("ELEC. SHAFT")).toBe("shaft");
    expect(coreKind("Patient room 12")).toBeNull();
    expect(coreKind("Upstairs store")).toBeNull();
  });
  it("loads the ground floor (or the one asked for) first, then outwards", () => {
    const fl = [{ id: 1, elevation: -10 }, { id: 2, elevation: -5 }, { id: 3, elevation: 0 }, { id: 4, elevation: 5 }, { id: 5, elevation: 10 }];
    expect(floorLoadOrder(fl).map((f) => f.id)).toEqual([3, 4, 2, 5, 1]);
    expect(floorLoadOrder(fl, 5).map((f) => f.id)).toEqual([5, 4, 3, 2, 1]);
  });
  it("calls a device slow on the median frame time", () => {
    expect(isSlow(Array(50).fill(16))).toBe(false);
    expect(isSlow([...Array(45).fill(60), ...Array(5).fill(10)])).toBe(true);
    expect(isSlow([...Array(45).fill(16), 900, 900, 900, 900, 900])).toBe(false);
    expect(isSlow(Array(10).fill(80))).toBe(false);
  });
});

describe("façade outline and camera presets", () => {
  it("traces the outside of two rooms with a wall gap between them as one rectangle", () => {
    const segs = outlineFromRooms([rectPoly(0, 0, 10, 6), rectPoly(10.2, 0, 10, 6)], 1);
    // Total outline length ≈ the perimeter of a 20 × 6 block (cells snap it to the grid).
    let len = 0;
    for (let i = 0; i < segs.length; i += 4) len += Math.hypot(segs[i + 2] - segs[i], segs[i + 3] - segs[i + 1]);
    expect(len).toBeGreaterThan(48);
    expect(len).toBeLessThan(62);
  });
  it("gives no façade for an empty floor or a huge site plan", () => {
    expect(outlineFromRooms([])).toEqual([]);
    expect(outlineFromRooms([rectPoly(0, 0, 5000, 5000)], 1)).toEqual([]);
  });
  it("places preset cameras", () => {
    expect(presetCamera("plan", { x: 1, y: 2, z: 3 }, 100)).toEqual({ x: 1, y: 127, z: 3.01 });
    expect(presetCamera("eye", { x: 0, y: 1.6, z: 0 }, 50).y).toBe(1.6);
  });
});

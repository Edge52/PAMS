import { describe, expect, it } from "vitest";
import { distribute, expandAllocations, parseSerials } from "./distribution";
import { autoArrange, clampViewBox, dragRect, fitRect, placeNewRoom, roomAt, zoomAt } from "./geometry";
import { layoutPins } from "./pins";

const icu = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, code: `3-ICU-BED${String(i + 1).padStart(2, "0")}`, name: `ICU bed ${i + 1}`, beds: 1, type: "ICU_BAY" }));
const ns = { id: 99, code: "3-ICU-NS", name: "Nurse station", beds: 0, type: "NURSE_STATION" };

describe("distribute", () => {
  it("puts 12 monitors one in each ICU bed", () => {
    const r = distribute({ mode: "PER_BED", rooms: [...icu, ns], quantity: 12 });
    expect(r.total).toBe(12);
    expect(r.allocations).toHaveLength(12);
    expect(r.allocations.every((a) => a.count === 1 && a.roomId !== 99)).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it("repeats rooms by bed count and warns when there are more units than beds", () => {
    const ward = [{ id: 1, code: "PR1", name: "Room 1", beds: 4 }, { id: 2, code: "PR2", name: "Room 2", beds: 2 }];
    const r = distribute({ mode: "PER_BED", rooms: ward, quantity: 8 });
    expect(r.allocations).toEqual([{ roomId: 1, count: 6 }, { roomId: 2, count: 2 }]);
    expect(r.warnings[0]).toMatch(/2 more than there are beds/);
  });
  it("one per room skips corridors and reports empty rooms", () => {
    const r = distribute({ mode: "PER_ROOM", rooms: [...icu.slice(0, 3), { id: 50, code: "COR", name: "Corridor", beds: 0, type: "CORRIDOR" }], quantity: 2 });
    expect(r.allocations).toEqual([{ roomId: 1, count: 1 }, { roomId: 2, count: 1 }]);
    expect(r.warnings[0]).toMatch(/1 room will get none/);
  });
  it("all in one room needs a room", () => {
    expect(distribute({ mode: "ONE_ROOM", rooms: icu, quantity: 5 }).warnings[0]).toMatch(/Choose/);
    expect(distribute({ mode: "ONE_ROOM", rooms: icu, quantity: 5, targetRoomId: 3 }).allocations).toEqual([{ roomId: 3, count: 5 }]);
  });
  it("manual counts warn when they do not add up", () => {
    const r = distribute({ mode: "MANUAL", rooms: icu, quantity: 4, manual: { 1: 2, 2: 1, 400: 9 } });
    expect(r.total).toBe(3);
    expect(r.warnings[0]).toMatch(/add up to 3/);
  });
  it("expands allocations and parses serials", () => {
    expect(expandAllocations([{ roomId: 1, count: 2 }, { roomId: 5, count: 1 }])).toEqual([1, 1, 5]);
    expect(parseSerials(" A1 \n\nB2, C3;D4\r\n")).toEqual(["A1", "B2", "C3", "D4"]);
  });
});

describe("geometry", () => {
  const room = { x: 20, y: 40, w: 70, h: 80 };
  it("arranges pins inside the room below the label", () => {
    const a = autoArrange(room, 7);
    expect(a.positions).toHaveLength(7);
    for (const p of a.positions) {
      expect(p.x).toBeGreaterThan(room.x);
      expect(p.x).toBeLessThan(room.x + room.w);
      expect(p.y).toBeGreaterThan(room.y + 10);
      expect(p.y).toBeLessThan(room.y + room.h);
    }
    expect(a.overflow).toBe(0);
  });
  it("reports overflow for a crowded room", () => {
    const a = autoArrange({ x: 0, y: 0, w: 40, h: 40 }, 200);
    expect(a.overflow).toBeGreaterThan(0);
    expect(a.positions.length).toBe(200 - a.overflow + 1);
  });
  it("finds the smallest room under a point", () => {
    const rooms = [{ id: 1, x: 0, y: 0, w: 500, h: 500 }, { id: 2, x: 10, y: 10, w: 50, h: 50 }];
    expect(roomAt(rooms, { x: 20, y: 20 })?.id).toBe(2);
    expect(roomAt(rooms, { x: 200, y: 200 })?.id).toBe(1);
    expect(roomAt(rooms, { x: 900, y: 900 })).toBeNull();
  });
  it("zooms around a point and respects limits", () => {
    const vb = { x: 0, y: 0, w: 1000, h: 600 };
    const z = zoomAt(vb, 2, { x: 500, y: 300 }, { minW: 50, maxW: 2000 });
    expect(z).toEqual({ x: 250, y: 150, w: 500, h: 300 });
    expect(zoomAt(vb, 1000, { x: 0, y: 0 }, { minW: 50, maxW: 2000 }).w).toBe(50);
  });
  it("keeps the plan reachable and fits rects to an aspect", () => {
    const c = clampViewBox({ x: 5000, y: -5000, w: 1000, h: 600 }, { w: 1000, h: 600 });
    expect(c.x).toBe(800);
    expect(c.y).toBe(-480);
    const f = fitRect({ x: 100, y: 100, w: 100, h: 100 }, 2);
    expect(f.w / f.h).toBeCloseTo(2);
    expect(f.x + f.w / 2).toBeCloseTo(150);
  });
  it("drags and resizes rectangles with snapping and minimum size", () => {
    const b = { w: 1000, h: 600 };
    expect(dragRect({ x: 20, y: 40, w: 100, h: 80 }, "move", 13, -100, b)).toEqual({ x: 35, y: 0, w: 100, h: 80 });
    expect(dragRect({ x: 20, y: 40, w: 100, h: 80 }, "se", 22, 300, b)).toEqual({ x: 20, y: 40, w: 120, h: 380 });
    expect(dragRect({ x: 20, y: 40, w: 100, h: 80 }, "nw", 200, 200, b)).toEqual({ x: 100, y: 100, w: 20, h: 20 });
    expect(placeNewRoom({ x: 0, y: 0, w: 1000, h: 600 }, [{ x: 450, y: 260, w: 100, h: 80 }])).toEqual({ x: 460, y: 270, w: 100, h: 80 });
  });
});

describe("layoutPins", () => {
  it("keeps explicit positions and auto-arranges the rest inside the room", () => {
    const rooms = [{ id: 1, x: 0, y: 0, w: 100, h: 100 }, { id: 2, x: 200, y: 0, w: 50, h: 50 }];
    const { pos, overflow } = layoutPins(rooms, [
      { id: 10, roomId: 1, posX: 50, posY: 60, sortKey: "b" },
      { id: 11, roomId: 1, posX: null, posY: null, sortKey: "a" },
      { id: 12, roomId: 1, posX: 900, posY: 900, sortKey: "c" }, // outside room → auto
      { id: 13, roomId: null, posX: null, posY: null, sortKey: "z" },
    ]);
    expect(pos.get(10)).toMatchObject({ x: 50, y: 60, auto: false });
    expect(pos.get(11)?.auto).toBe(true);
    expect(pos.get(12)!.x).toBeLessThan(100);
    expect(pos.has(13)).toBe(false);
    expect(overflow).toEqual([]);
  });
});

describe("pins in rooms with a CAD outline (regression)", () => {
  it("keeps auto-placed pins inside an L-shaped room instead of its bounding box", async () => {
    const { layoutPins } = await import("./pins");
    const { pointInPolygon } = await import("../../components/assets/twin/geometry");
    const poly: [number, number][] = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]];
    const room = { id: 1, x: 0, y: 0, w: 100, h: 100, polygon: poly };
    const assets = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, roomId: 1, posX: null, posY: null, sortKey: String(i) }));
    const { pos } = layoutPins([room], assets);
    expect(pos.size).toBe(8);
    for (const p of pos.values()) expect(pointInPolygon([p.x, p.y], poly)).toBe(true);
  });
});

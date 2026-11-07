import { describe, expect, it } from "vitest";
import { compareSchedules, grossArea, spaceSchedule, toSnapshot, type SpaceRoom } from "./space-planning";

const box = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (o: Partial<SpaceRoom> & { id: number; poly: [number, number][] }): SpaceRoom => ({ floorId: 1, code: `R${o.id}`, name: `Room ${o.id}`, type: "OFFICE", departmentId: 1, beds: 0, devices: 0, minAreaM2: null, core: false, ...o });

describe("space planning (wave 17, phase 6)", () => {
  it("traces gross area across the walls between rooms", () => {
    // Two 5 × 4 rooms with a 0.6 m wall between them: gross ≈ 10.6 × 4 (on a 0.5 m grid), more than the rooms' 40.
    const g = grossArea([box(0, 0, 5, 4), box(5.6, 0, 5, 4)]);
    expect(g).toBeGreaterThan(41); expect(g).toBeLessThan(46);
  });
  it("splits floors into net, circulation and cores, and departments into types, density and capacity", () => {
    const rooms = [
      room({ id: 1, poly: box(0, 0, 10, 5), type: "WARD", beds: 4, minAreaM2: 15, devices: 6 }),  // 50 m², 3 places, 4 beds: over
      room({ id: 2, poly: box(0, 5, 10, 2), type: "CORRIDOR", name: "Corridor" }),
      room({ id: 3, poly: box(10, 0, 3, 3), name: "Stair 1", core: true }),
      room({ id: 4, poly: box(0, 7, 5, 4), type: "OFFICE", departmentId: 2, devices: 1 }),
    ];
    const s = spaceSchedule([{ id: 1, name: "Ground", level: 0 }], rooms, [{ id: 1, name: "Ward A" }, { id: 2, name: "Admin" }]);
    const f = s.floors[0];
    expect(f).toMatchObject({ net: 70, circulation: 20, cores: 9, rooms: 4 });
    expect(f.gross).toBeGreaterThanOrEqual(99);
    expect(f.netToGross!).toBeLessThan(0.71);
    const w = s.departments.find((d) => d.name === "Ward A")!;
    expect(w).toMatchObject({ net: 50, circulation: 20, beds: 4, devices: 6, density: 12 });
    expect(w.capacity).toMatchObject({ rooms: 1, beds: 4, places: 3 });
    expect(w.capacity.over[0]).toMatchObject({ id: 1, capacity: 3 });
    expect(s.departments.map((d) => d.name)).toEqual(["Ward A", "Admin"]);
  });
  it("compares two schedules by department", () => {
    const fl = [{ id: 1, name: "Ground", level: 0 }];
    const before = toSnapshot(spaceSchedule(fl, [room({ id: 1, poly: box(0, 0, 10, 5) })], [{ id: 1, name: "Ward A" }]));
    const after = toSnapshot(spaceSchedule(fl, [room({ id: 1, poly: box(0, 0, 10, 8) }), room({ id: 2, poly: box(0, 8, 4, 4), departmentId: 3 })], [{ id: 1, name: "Ward A" }, { id: 3, name: "Pharmacy" }]));
    const c = compareSchedules(before, after);
    expect(c.departments[0]).toMatchObject({ label: "Ward A", before: { net: 50 }, after: { net: 80 } });
    expect(c.departments.find((d) => d.label === "Pharmacy")).toMatchObject({ before: null, after: { net: 16 } });
    expect(c.floors[0]).toMatchObject({ before: 50, after: 96 });
  });
});

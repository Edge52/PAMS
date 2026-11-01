import { describe, expect, it } from "vitest";
import { checkBuilding, deptKey, planMerge, shapeChanged, type ExistingFloor, type ExistingRoom } from "./cad-merge";
import type { CadBuilding, CadRoom, Pt } from "./cad-rooms";

const sq = (x: number, y: number, s = 50): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const room = (code: string, name: string, dept: string | null, poly: Pt[]): CadRoom => ({ code, name, dept, num: null, shape: "walls", area: null, poly, label: poly[0] });
const building = (floors: { level: number; rooms: CadRoom[] }[]): CadBuilding => ({
  name: "Test", unitsPerMetre: 10, planWidth: 1000, planHeight: 1000,
  floors: floors.map((f) => ({ code: `L${f.level}`, name: `Level ${f.level}`, level: f.level, elevation: f.level * 5, sourceFile: "x.dwg", walls: [0, 0, 1, 1], doors: [], glass: [], columns: [], rooms: f.rooms })),
});

describe("planMerge", () => {
  const floors: ExistingFloor[] = [{ id: 1, level: 0, name: "Ground" }, { id: 2, level: 1, name: "First" }];
  const rooms: ExistingRoom[] = [
    { id: 10, floorId: 1, code: "GF-ICU-01", name: "ICU (1)", deptCode: "ICU", poly: sq(0, 0), assets: 4 },
    { id: 11, floorId: 1, code: "GF-ICU-02", name: "ICU (2)", deptCode: "ICU", poly: sq(60, 0), assets: 0 },
    { id: 12, floorId: 1, code: "GF-STO-01", name: "Store", deptCode: "GEN", poly: sq(120, 0), assets: 2 },
    { id: 13, floorId: 1, code: "GF-OLD-01", name: "Old office", deptCode: "GEN", poly: sq(180, 0), assets: 0 },
    { id: 14, floorId: 1, code: "R-HAND", name: "Hand-drawn", deptCode: null, poly: null, assets: 0 },
  ];
  const b = building([
    { level: 0, rooms: [
      room("GF-ICU-01", "ICU (1)", "ICU", sq(0, 0)),           // unchanged
      room("GF-ICU-02", "ICU ISOLATION", "ICU", sq(60, 0, 70)), // renamed and bigger
      room("GF-NEW-01", "MEDS", "M/S1", sq(300, 0)),            // new, with a new department
    ] },
    { level: 2, rooms: [room("F2-A-01", "OFFICE", "ADM", sq(0, 0))] },
  ]);
  const plan = planMerge(floors, rooms, b, ["ICU", "GEN", "ADM"]);
  it("lists only what changed, by room code", () => {
    const kinds = plan.changes.filter((c) => c.floorLevel === 0).map((c) => `${c.kind}:${c.code}`).sort();
    expect(kinds).toEqual(["added:GF-NEW-01", "kept:GF-STO-01", "removed:GF-OLD-01", "renamed:GF-ICU-02", "reshaped:GF-ICU-02"]);
    expect(plan.changes.find((c) => c.kind === "renamed")).toMatchObject({ was: "ICU (2)", name: "Icu Isolation".replace("Icu", "ICU") });
  });
  it("keeps a room that still holds equipment and never touches hand-drawn rooms", () => {
    expect(plan.changes.find((c) => c.code === "GF-STO-01")).toMatchObject({ kind: "kept", assets: 2 });
    expect(plan.changes.some((c) => c.code === "R-HAND")).toBe(false);
  });
  it("adds new floors, keeps floors the drawing doesn't have, and creates new departments", () => {
    expect(plan.floorsAdded.map((f) => f.level)).toEqual([2]);
    expect(plan.floorsUpdated.map((f) => f.floorId)).toEqual([1]);
    expect(plan.floorsMissing.map((f) => f.level)).toEqual([1]);
    expect(plan.newDepartments).toEqual(["M/S1"]);
    expect(plan.counts).toMatchObject({ added: 2, renamed: 1, reshaped: 1, removed: 1, kept: 1, department: 0 });
  });
  it("notices a room moved to another department", () => {
    const p = planMerge(floors, rooms, building([{ level: 0, rooms: [room("GF-ICU-01", "ICU (1)", "CCU", sq(0, 0))] }]), ["ICU", "CCU"]);
    expect(p.changes.find((c) => c.kind === "department")).toMatchObject({ code: "GF-ICU-01", was: "ICU" });
  });
});

describe("shapeChanged", () => {
  it("ignores tiny drawing noise and catches real changes", () => {
    expect(shapeChanged(sq(0, 0), sq(1, 1))).toBe(false);
    expect(shapeChanged(sq(0, 0), sq(0, 0, 60))).toBe(true);
    expect(shapeChanged(null, sq(0, 0))).toBe(true);
  });
});

describe("deptKey and checkBuilding", () => {
  it("compares department codes without punctuation", () => { expect(deptKey("M/S1")).toBe(deptKey("MS1")); });
  it("rejects files that aren't building files or repeat a room code", () => {
    expect(checkBuilding({ hello: 1 })).toMatch(/no floors/);
    const b = building([{ level: 0, rooms: [room("A", "X", null, sq(0, 0)), room("a", "Y", null, sq(60, 0))] }]);
    expect(checkBuilding(b)).toMatch(/appears twice/);
    expect(checkBuilding(building([{ level: 0, rooms: [room("A", "X", null, sq(0, 0))] }]))).toBeNull();
  });
});

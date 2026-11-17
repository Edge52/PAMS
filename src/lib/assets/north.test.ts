import { describe, expect, it } from "vitest";
import { cleanNorth, compassTurn, compassWords, nearestTurn, normDeg, northFor, northLabel, northOnPlan, viewBearing } from "./north";

const close = (a: [number, number], b: [number, number]) => { expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9); };

describe("north on the plans (wave 28)", () => {
  it("reads the angle from a form", () => {
    expect(cleanNorth("")).toBeNull();
    expect(cleanNorth("  ")).toBeNull();
    expect(cleanNorth("30")).toBe(30);
    expect(cleanNorth("30°")).toBe(30);
    expect(cleanNorth("12,25")).toBe(12.3);
    expect(cleanNorth("-90")).toBe(270);
    expect(cleanNorth("360")).toBe(0);
    expect(cleanNorth("359.97")).toBe(0);
    expect(cleanNorth("north")).toBe("invalid");
    expect(cleanNorth("99999")).toBe("invalid");
  });

  it("points north on the plan (y runs down)", () => {
    close(northOnPlan(0), [0, -1]);
    close(northOnPlan(90), [1, 0]);
    close(northOnPlan(180), [0, 1]);
    close(northOnPlan(-90), [-1, 0]);
    expect(normDeg(-30)).toBe(330);
  });

  it("finds which way the camera looks", () => {
    expect(viewBearing({ x: 0, z: 10 }, { x: 0, z: 0 })).toBe(0); // looking up the plan
    expect(viewBearing({ x: 0, z: 0 }, { x: 5, z: 0 })).toBe(90); // to the right
    expect(viewBearing({ x: 0, z: 0 }, { x: 0, z: 5 })).toBe(180);
    expect(viewBearing({ x: 0, z: 0 }, { x: -5, z: 0 })).toBe(270);
    expect(viewBearing({ x: 1, z: 1 }, { x: 1, z: 1 })).toBeNull();
  });

  it("turns the needle with the camera", () => {
    // North at the top of the plan: looking up the plan it points ahead, looking right it points left.
    expect(compassTurn(0, 0)).toBe(0);
    expect(compassTurn(0, 90)).toBe(270);
    expect(compassTurn(0, 180)).toBe(180);
    // North 30° clockwise of the plan's top, camera looking 30° the same way: straight ahead.
    expect(compassTurn(30, 30)).toBe(0);
    expect(compassTurn(30, 0)).toBe(30);
    expect(compassWords(0)).toBe("North is straight ahead");
    expect(compassWords(270)).toBe("North is to the left");
    expect(compassWords(100)).toBe("North is to the right");
    expect(compassWords(-170)).toBe("North is behind");
  });

  it("eases the short way round", () => {
    expect(nearestTurn(350, 10)).toBe(370);
    expect(nearestTurn(10, 350)).toBe(-10);
    expect(nearestTurn(720, 90)).toBe(810);
    expect(Math.abs(nearestTurn(0, 180))).toBe(180); // half a turn: either way
  });

  it("describes the angle", () => {
    expect(northLabel(0)).toBe("North is at the top of the plan.");
    expect(northLabel(30)).toBe("North is 30° clockwise from the top of the plan.");
    expect(northLabel(300)).toBe("North is 60° anticlockwise from the top of the plan.");
  });

  it("picks the building's angle for the view", () => {
    const floors = [{ id: 1, northDeg: 20 }, { id: 2, northDeg: 20 }, { id: 3, northDeg: null }, { id: 4 }];
    expect(northFor(floors, 1)).toBe(20);
    expect(northFor(floors, 3)).toBeNull();
    expect(northFor(floors, null)).toBe(20);
    expect(northFor([...floors, { id: 5, northDeg: 110 }], null)).toBeNull(); // buildings disagree
    expect(northFor([{ id: 1, northDeg: 0 }], null)).toBe(0);
  });
});

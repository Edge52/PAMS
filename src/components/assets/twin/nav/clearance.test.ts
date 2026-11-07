import { describe, expect, it } from "vitest";
import { buildNetwork } from "./network";
import { clearWidth, legClearance, longestThroughCorner } from "./clearance";

/** An L-shaped corridor: 20 m east (width wE), then 20 m north (width wN), walls as segments. */
function corridor(wE: number, wN: number) {
  const s: number[] = [];
  const seg = (a: number, b: number, c: number, d: number) => s.push(a, b, c, d);
  seg(0, 0, 20 + wN, 0); seg(20 + wN, 0, 20 + wN, 20 + wE); // outer
  seg(0, wE, 20, wE); seg(20, wE, 20, 20 + wE);               // inner
  seg(0, 0, 0, wE); seg(20, 20 + wE, 20 + wN, 20 + wE);         // ends
  const rooms = [{ id: 1, name: "Corridor", poly: [[0, 0], [20 + wN, 0], [20 + wN, 20 + wE], [20, 20 + wE], [20, wE], [0, wE]] as [number, number][] }];
  return buildNetwork(1, s, rooms, { cell: 0.25 });
}

describe("bed clearance on routes (wave 17, phase 8)", () => {
  it("knows which corners a bed can turn", () => {
    expect(longestThroughCorner(2.4, 2.4, 1.05)).toBeGreaterThan(2.3);
    expect(longestThroughCorner(1.4, 1.4, 1.05)).toBeLessThan(2.3);
    expect(longestThroughCorner(1.0, 3, 1.05)).toBe(0);
  });
  it("measures corridor widths to within a cell", () => {
    const n = corridor(2.4, 2.4);
    expect(clearWidth(n, 10, 1.2, 1, 0)!).toBeGreaterThan(2.0);
    expect(clearWidth(n, 10, 1.2, 1, 0)!).toBeLessThan(2.7);
  });
  it("flags a narrow corridor and a corner a bed can't turn", () => {
    const wide = legClearance(corridor(2.4, 2.4), [[1, 1.2], [21.2, 1.2], [21.2, 21]]);
    expect(wide.pinches).toEqual([]);
    expect(wide.turns[0]?.fits).toBe(true);
    const narrow = legClearance(corridor(1.4, 1.4), [[1, 0.7], [20.7, 0.7], [20.7, 21]]);
    expect(narrow.pinches.some((p) => p.need === "passing" && p.length > 3)).toBe(true);
    expect(narrow.turns[0]?.fits).toBe(false);
    expect(narrow.narrowest!.width).toBeLessThan(1.8);
  });
});

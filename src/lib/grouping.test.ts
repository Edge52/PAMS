import { describe, expect, it } from "vitest";
import { groupBy, sumBy } from "./grouping";

describe("grouping (wave 41)", () => {
  it("groups rows by a key, keeping their order", () => {
    const rows = [{ o: 1, p: "a" }, { o: 2, p: "b" }, { o: 1, p: "c" }];
    expect(groupBy(rows, (r) => r.o, (r) => r.p)).toEqual(new Map([[1, ["a", "c"]], [2, ["b"]]]));
    expect(groupBy(rows, (r) => r.o).get(2)).toEqual([{ o: 2, p: "b" }]);
    expect(groupBy([], (r: { o: number }) => r.o).size).toBe(0);
  });
  it("adds up numbers and numeric strings per key", () => {
    const rows = [{ k: "x", v: "10.50" }, { k: "y", v: 2 }, { k: "x", v: null }, { k: "x", v: "abc" }, { k: "x", v: 1 }];
    expect(sumBy(rows, (r) => r.k, (r) => r.v)).toEqual(new Map([["x", 11.5], ["y", 2]]));
  });
});

import { describe, expect, it } from "vitest";
import { nextSort, parseSort, sortRows } from "./list";

describe("list sorting (wave 21)", () => {
  const keys = ["name", "value"] as const;
  it("reads the sort from the address and ignores unknown columns", () => {
    expect(parseSort({ sort: "value", dir: "desc" }, keys)).toEqual({ key: "value", dir: "desc" });
    expect(parseSort({ sort: "name" }, keys)).toEqual({ key: "name", dir: "asc" });
    expect(parseSort({ sort: "password" }, keys)).toBeNull();
    expect(parseSort({}, keys, { key: "name", dir: "asc" })).toEqual({ key: "name", dir: "asc" });
  });
  it("sorts text without case, numbers as numbers, empty last", () => {
    const rows = [{ name: "beta", value: 10 }, { name: "Alpha", value: 2 }, { name: null, value: null }, { name: "WO-10", value: 30 }, { name: "WO-9", value: 5 }];
    const get = { name: (r: (typeof rows)[number]) => r.name, value: (r: (typeof rows)[number]) => r.value };
    expect(sortRows(rows, { key: "name", dir: "asc" }, get).map((r) => r.name)).toEqual(["Alpha", "beta", "WO-9", "WO-10", null]);
    expect(sortRows(rows, { key: "value", dir: "desc" }, get).map((r) => r.value)).toEqual([30, 10, 5, 2, null]);
    expect(sortRows(rows, null, get)).toBe(rows);
  });
  it("cycles a heading: up, down, off", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toBeNull();
    expect(nextSort({ key: "value", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

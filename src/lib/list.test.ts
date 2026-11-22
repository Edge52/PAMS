import { describe, expect, it } from "vitest";
import { nextSort, pageFor, pagingNote, parseSort, shownNote, sortRows } from "./list";

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

describe("long lists (B6 / CO-11)", () => {
  it("says when a list is cut", () => {
    expect(shownNote(500, 1234, "parts")).toBe("Showing the first 500 of 1,234 parts. Narrow the filters to see the rest.");
    expect(shownNote(12, 12)).toBeNull();
  });
  it("pages through a list and keeps the page in range", () => {
    expect(pageFor({}, 734, 100)).toMatchObject({ page: 1, pages: 8, offset: 0, from: 1, to: 100 });
    expect(pageFor({ page: "8" }, 734, 100)).toMatchObject({ page: 8, offset: 700, from: 701, to: 734 });
    expect(pageFor({ page: "99" }, 734, 100).page).toBe(8);
    expect(pageFor({ page: "-3" }, 734, 100).page).toBe(1);
    expect(pageFor({ page: "x" }, 0, 100)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
    expect(pagingNote(pageFor({ page: "2" }, 734, 100), "invoices")).toBe("Showing 101–200 of 734 invoices.");
    expect(pagingNote(pageFor({}, 50, 100))).toBeNull();
  });
});

describe("capRows (B6/CO-11)", () => {
  it("says so when the list stops at its limit", async () => {
    const { capRows } = await import("./list");
    expect(capRows([1, 2, 3, 4], 3, "parts")).toEqual({ rows: [1, 2, 3], note: "Showing the first 3 parts. Narrow the filters to see the rest." });
    expect(capRows([1, 2, 3], 3, "parts")).toEqual({ rows: [1, 2, 3], note: null });
  });
});

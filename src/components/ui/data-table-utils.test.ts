import { describe, expect, it } from "vitest";
import { ariaSort, hiddenColumns, hideCss, sortHref, tableSort } from "./data-table-utils";

describe("DataTable sorting (wave 38)", () => {
  const allowed = ["name", "value"] as const;
  it("only accepts keys on the allow-list", () => {
    expect(tableSort({ sort: "value", dir: "desc" }, allowed)).toEqual({ key: "value", dir: "desc" });
    expect(tableSort({ sort: "name", dir: "sideways" }, allowed)).toEqual({ key: "name", dir: "asc" });
    expect(tableSort({ sort: "password_hash" }, allowed)).toBeNull();
    expect(tableSort({ sort: "name; drop table users" }, allowed)).toBeNull();
    expect(tableSort({ sort: ["value", "name"] }, allowed)).toEqual({ key: "value", dir: "asc" });
    expect(tableSort({}, allowed, { key: "name", dir: "asc" })).toEqual({ key: "name", dir: "asc" });
  });
  it("links cycle ascending, descending, off and keep the filters but not the page", () => {
    const sp = { q: "pump", status: ["A", "B"], page: "3" };
    expect(sortHref("/x", sp, "name", null)).toBe("/x?q=pump&status=A&status=B&sort=name");
    expect(sortHref("/x", { ...sp, sort: "name" }, "name", { key: "name", dir: "asc" })).toBe("/x?q=pump&status=A&status=B&sort=name&dir=desc");
    expect(sortHref("/x", { sort: "name", dir: "desc" }, "name", { key: "name", dir: "desc" })).toBe("/x");
    expect(sortHref("/x", { sort: "name", dir: "desc" }, "value", { key: "name", dir: "desc" })).toBe("/x?sort=value");
  });
  it("says which heading is sorted", () => {
    expect(ariaSort({ key: "name", dir: "asc" }, "name")).toBe("ascending");
    expect(ariaSort({ key: "name", dir: "desc" }, "name")).toBe("descending");
    expect(ariaSort({ key: "name", dir: "desc" }, "value")).toBeUndefined();
    expect(ariaSort(null, "value")).toBeUndefined();
  });
});

describe("DataTable column choice", () => {
  const cols = [{ key: "tag" }, { key: "serial", optional: true, hidden: true }, { key: "maker", optional: true }, { key: "bad key", optional: true }];
  it("starts from the columns marked hidden", () => {
    expect(hiddenColumns(null, cols)).toEqual(["serial"]);
    expect(hiddenColumns("not json", cols)).toEqual(["serial"]);
    expect(hiddenColumns('{"a":1}', cols)).toEqual(["serial"]);
  });
  it("keeps only optional, known columns from what was stored", () => {
    expect(hiddenColumns('["maker","tag","nope",3]', cols)).toEqual(["maker"]);
    expect(hiddenColumns("[]", cols)).toEqual([]);
    expect(hiddenColumns('["bad key"]', cols)).toEqual([]);
  });
  it("writes CSS for safe keys only", () => {
    expect(hideCss("assets", ["serial", "maker"])).toBe('[data-dt="assets"] [data-col="serial"], [data-dt="assets"] [data-col="maker"] { display: none !important; }');
    expect(hideCss("assets", [])).toBe("");
    expect(hideCss("assets", ['x"]{}body{'])).toBe("");
    expect(hideCss('a"b', ["serial"])).toBe("");
  });
});

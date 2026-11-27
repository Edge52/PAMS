import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { capExport, exportNote, pageHref, pageLinks, pageRows, shownLine, sqlOrder } from "./paging";

const render = (parts: ReturnType<typeof sqlOrder>) => new PgDialect().sqlToQuery(sql.join(parts, sql`, `)).sql;

describe("paging helpers (wave 41)", () => {
  it("pages a list in memory and keeps the page in range", () => {
    const list = Array.from({ length: 120 }, (_, i) => i + 1);
    expect(pageRows(list, {}).rows).toHaveLength(50);
    const p3 = pageRows(list, { page: "3" });
    expect(p3.rows).toEqual(list.slice(100));
    expect(p3.paging).toMatchObject({ page: 3, pages: 3, from: 101, to: 120, total: 120 });
    expect(pageRows(list, { page: "99" }).paging.page).toBe(3);
    expect(pageRows(list, { page: "x" }).paging.page).toBe(1);
    expect(pageRows([], { page: "2" }).paging).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
  });

  it("builds page links that keep the filters and sort", () => {
    expect(pageHref("/x", { q: "pump", sort: "date", dir: "desc", page: "4" }, 2)).toBe("/x?q=pump&sort=date&dir=desc&page=2");
    expect(pageHref("/x", { q: "pump", page: "4" }, 1)).toBe("/x?q=pump");
    expect(pageHref("/x", { ids: ["1", "2"], empty: "" }, 1)).toBe("/x?ids=1&ids=2");
    expect(pageHref("/x", {}, 1)).toBe("/x");
  });

  it("lists page numbers with gaps", () => {
    expect(pageLinks(1, 1)).toEqual([]);
    expect(pageLinks(1, 3)).toEqual([1, 2, 3]);
    expect(pageLinks(5, 10)).toEqual([1, 0, 4, 5, 6, 0, 10]);
    expect(pageLinks(10, 10)).toEqual([1, 0, 9, 10]);
  });

  it("orders by the chosen column with empty values last, else the fallback", () => {
    const cols = { name: sql`"name"`, date: sql`"date"` };
    expect(render(sqlOrder({ key: "name", dir: "asc" }, cols, [sql`"id" desc`], [sql`"id"`]))).toBe(`"name" asc nulls last, "id"`);
    expect(render(sqlOrder({ key: "date", dir: "desc" }, cols, [sql`"id" desc`]))).toBe(`"date" desc nulls last`);
    expect(render(sqlOrder(null, cols, [sql`"id" desc`], [sql`"id"`]))).toBe(`"id" desc, "id"`);
  });

  it("caps exports and says so", () => {
    expect(capExport([1, 2, 3], 2)).toEqual({ rows: [1, 2], cut: true });
    expect(capExport([1, 2], 2)).toEqual({ rows: [1, 2], cut: false });
    expect(exportNote(false)).toBeNull();
    expect(exportNote(true, 20000)).toContain("20,000");
  });

  it("says how many rows are shown", () => {
    expect(shownLine({ page: 2, pages: 3, size: 50, offset: 50, total: 120, from: 51, to: 100 }, "offers")).toBe("Showing 51–100 of 120 offers");
    expect(shownLine({ page: 1, pages: 1, size: 50, offset: 0, total: 3, from: 1, to: 3 }, "offers")).toBe("3 offers");
    expect(shownLine({ page: 1, pages: 1, size: 50, offset: 0, total: 0, from: 0, to: 0 }, "offers")).toBe("No offers");
  });
});

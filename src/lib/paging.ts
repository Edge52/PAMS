/**
 * Server-side paging for the main lists (wave 41). Pure: no database. A page reads `?page=`, `?sort=` and `?dir=`,
 * counts the matching rows, then asks the database for one page in the chosen order:
 *
 *   const sort = tableSort(sp, SORT_KEYS, { key: "date", dir: "desc" });
 *   const [{ n }] = await db.select({ n: count() }).from(t).where(where);
 *   const pg = pageFor(sp, n, PAGE_SIZE);
 *   const rows = await db.select().from(t).where(where).orderBy(...sqlOrder(sort, { date: t.date, … }, [desc(t.id)]))
 *     .limit(pg.size).offset(pg.offset);
 *
 * Lists whose rows are worked out in code (due states) use `pageRows` on the sorted list instead.
 * Relative imports only (Vitest has no `@/` alias).
 */
import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { pageFor, type Paging, type Sort } from "./list";

export { pageFor, pagingNote, type Paging } from "./list";

/** Rows on one page of a main list. */
export const PAGE_SIZE = 50;
/** Most rows a CSV or Excel export writes; the file says when it stops there. */
export const EXPORT_LIMIT = 20_000;

type Params = Record<string, string | string[] | undefined>;

/** One page of a list already in memory (sorted), with its paging. */
export function pageRows<T>(rows: T[], sp: Params, size = PAGE_SIZE): { rows: T[]; paging: Paging } {
  const paging = pageFor(sp, rows.length, size);
  return { rows: rows.slice(paging.offset, paging.offset + size), paging };
}

/** The address of page `page` of this list: every other parameter is kept; page 1 has no `page`. */
export function pageHref(path: string, sp: Params, page: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) if (one !== "") q.append(k, one);
  }
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The page links to show: first, last, and the pages next to this one (0 = a gap). */
export function pageLinks(page: number, pages: number): number[] {
  if (pages <= 1) return [];
  const want = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  const out: number[] = [];
  for (const p of want) { if (out.length && p - out[out.length - 1] > 1) out.push(0); out.push(p); }
  return out;
}

/**
 * ORDER BY for the sort asked for: the column named in `columns` (empty values last in both directions), then
 * `tieBreak` so pages don't overlap. No sort (or an unknown key) → `fallback`.
 */
export function sqlOrder<K extends string>(sort: Sort<K> | null, columns: Record<K, SQL | PgColumn>, fallback: SQL[], tieBreak: SQL[] = []): SQL[] {
  const c = sort ? columns[sort.key] : undefined;
  if (!sort || !c) return [...fallback, ...tieBreak];
  return [sort.dir === "desc" ? sql`${c} desc nulls last` : sql`${c} asc nulls last`, ...tieBreak];
}

/** The note for an export cut at `limit` rows, or null when every matching row is in the file. */
export function exportNote(cut: boolean, limit = EXPORT_LIMIT): string | null {
  return cut ? `Only the first ${limit.toLocaleString("en")} matching rows are in this file. Narrow the filters to export the rest.` : null;
}

/** An export read with `.limit(EXPORT_LIMIT + 1)`: the rows to write and whether it was cut. */
export function capExport<T>(rows: T[], limit = EXPORT_LIMIT): { rows: T[]; cut: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), cut: true } : { rows, cut: false };
}

/** "Showing 51–100 of 734 offers" (always, also on one page: "3 offers"). */
export function shownLine(p: Paging, what: string): string {
  const n = (x: number) => x.toLocaleString("en");
  if (p.total === 0) return `No ${what}`;
  return p.pages > 1 ? `Showing ${n(p.from)}–${n(p.to)} of ${n(p.total)} ${what}` : `${n(p.total)} ${what}`;
}

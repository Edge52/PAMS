/** List helpers (wave 21): sorting a list by a column named in the address (`?sort=supplier&dir=desc`). Pure. */
export type Dir = "asc" | "desc";
export type Sort<K extends string> = { key: K; dir: Dir };
type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The sort asked for in the address, when the column is one the list offers; else `fallback`. */
export function parseSort<K extends string>(sp: Params, keys: readonly K[], fallback: Sort<K> | null = null): Sort<K> | null {
  const key = keys.find((k) => k === one(sp.sort));
  if (!key) return fallback;
  return { key, dir: one(sp.dir) === "desc" ? "desc" : "asc" };
}

/** Sorted copy of `rows`. Empty values go last in both directions; text compares without case, numbers as numbers. */
export function sortRows<T, K extends string>(rows: T[], sort: Sort<K> | null, get: Record<K, (r: T) => string | number | null | undefined>): T[] {
  if (!sort) return rows;
  const value = get[sort.key], sign = sort.dir === "desc" ? -1 : 1;
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" }) * sign;
  });
}

/** What clicking a column heading asks for next: ascending first, then descending, then back to the list's own order. */
export function nextSort<K extends string>(current: Sort<K> | null, key: K): Sort<K> | null {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/* ── Long lists (audit B6 / CO-11): say when a list is cut, or page through it ── */

const count = (n: number) => n.toLocaleString("en");

/** The note under a list cut at `shown` rows of `total`, or null when everything is shown. */
export function shownNote(shown: number, total: number, what = "rows"): string | null {
  return shown < total ? `Showing the first ${count(shown)} of ${count(total)} ${what}. Narrow the filters to see the rest.` : null;
}

export type Paging = { page: number; pages: number; size: number; offset: number; total: number; from: number; to: number };

/** The page asked for in the address (`?page=2`), kept within 1 … the last page. */
export function pageFor(sp: Params, total: number, size: number): Paging {
  const pages = Math.max(1, Math.ceil(total / size));
  const asked = Number.parseInt(one(sp.page) ?? "", 10);
  const page = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), pages) : 1;
  const offset = (page - 1) * size;
  return { page, pages, size, offset, total, from: total ? offset + 1 : 0, to: Math.min(total, offset + size) };
}

/** "Showing 101–200 of 734", or null when one page holds everything. */
export function pagingNote(p: Paging, what = "rows"): string | null {
  return p.pages > 1 ? `Showing ${count(p.from)}–${count(p.to)} of ${count(p.total)} ${what}.` : null;
}

/**
 * A list read with `.limit(max + 1)` (audit B6/CO-11): the first `max` rows, and a note when there were more, so a
 * page never stops at its limit without saying so.
 */
export function capRows<T>(rows: T[], max: number, what = "rows"): { rows: T[]; note: string | null } {
  return rows.length > max
    ? { rows: rows.slice(0, max), note: `Showing the first ${count(max)} ${what}. Narrow the filters to see the rest.` }
    : { rows, note: null };
}

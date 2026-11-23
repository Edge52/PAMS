/**
 * Pure helpers for <DataTable> (wave 38): sort links in the address, which columns are hidden, the CSS that hides them.
 * Relative imports only (Vitest has no `@/` alias).
 */
import { nextSort, parseSort, type Sort } from "../../lib/list";

export type Params = Record<string, string | string[] | undefined>;

/** The sort asked for in the address, only when its key is on the list's allow-list. Re-exported for the pages. */
export function tableSort<K extends string>(sp: Params, allowed: readonly K[], fallback: Sort<K> | null = null): Sort<K> | null {
  return parseSort(sp, allowed, fallback);
}

/** The address a sortable heading links to: ascending, then descending, then the list's own order; drops the page. */
export function sortHref(path: string, sp: Params, key: string, current: Sort<string> | null): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "sort" || k === "dir" || k === "page" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const next = nextSort(current, key);
  if (next) { q.set("sort", next.key); if (next.dir === "desc") q.set("dir", "desc"); }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** The heading's aria-sort value. */
export function ariaSort(current: Sort<string> | null, key: string): "ascending" | "descending" | undefined {
  if (current?.key !== key) return undefined;
  return current.dir === "asc" ? "ascending" : "descending";
}

export type ColumnInfo = { key: string; optional?: boolean; hidden?: boolean };

/** Keys safe to use in a CSS attribute selector and a storage key. */
export const safeKey = (k: string) => /^[a-zA-Z0-9_-]{1,40}$/.test(k);

/**
 * The columns hidden in this browser. `stored` is the remembered JSON list of hidden keys (null = never chosen: the
 * columns marked `hidden`). Only optional columns can be hidden; unknown or broken values are ignored.
 */
export function hiddenColumns(stored: string | null, columns: ColumnInfo[]): string[] {
  const optional = columns.filter((c) => c.optional && safeKey(c.key));
  if (stored === null) return optional.filter((c) => c.hidden).map((c) => c.key);
  let list: unknown;
  try { list = JSON.parse(stored); } catch { return optional.filter((c) => c.hidden).map((c) => c.key); }
  if (!Array.isArray(list)) return optional.filter((c) => c.hidden).map((c) => c.key);
  const asked = new Set(list.filter((x): x is string => typeof x === "string"));
  return optional.filter((c) => asked.has(c.key)).map((c) => c.key);
}

/** The CSS that hides `hidden` columns of table `id` (cells carry `data-col`). Empty when nothing is hidden. */
export function hideCss(id: string, hidden: string[]): string {
  const keys = hidden.filter(safeKey);
  if (!safeKey(id) || keys.length === 0) return "";
  return `${keys.map((k) => `[data-dt="${id}"] [data-col="${k}"]`).join(", ")} { display: none !important; }`;
}

/** localStorage key for a table's column choice. */
export const columnsStorageKey = (id: string) => `hpams.table.${id}.hidden`;

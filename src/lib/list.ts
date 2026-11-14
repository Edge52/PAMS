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

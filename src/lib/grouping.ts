/** Grouping rows read in one query (wave 41), so a list doesn't ask the database once per row. Pure. */

/** Rows grouped by `key`, each group in the rows' order, values from `value`. Keys with no rows are absent. */
export function groupBy<T, K, V = T>(rows: readonly T[], key: (r: T) => K, value: (r: T) => V = (r) => r as unknown as V): Map<K, V[]> {
  const out = new Map<K, V[]>();
  for (const r of rows) { const k = key(r); const list = out.get(k); if (list) list.push(value(r)); else out.set(k, [value(r)]); }
  return out;
}

/** The sum of `value` per `key` (numbers or Postgres numeric strings). */
export function sumBy<T, K>(rows: readonly T[], key: (r: T) => K, value: (r: T) => number | string | null | undefined): Map<K, number> {
  const out = new Map<K, number>();
  for (const r of rows) { const v = Number(value(r) ?? 0); out.set(key(r), (out.get(key(r)) ?? 0) + (Number.isFinite(v) ? v : 0)); }
  return out;
}

/**
 * Book value grouping (pure). "Value left" is book value ÷ cost over the devices whose value could be worked out only
 * (audit DL-17): devices with no cost, no rate or no start date used to add their cost but no book value, which
 * understated the percentage. They are still counted under "Not worked out".
 */
import type { BookValueRow } from "../assets/depreciation-server";
import { sumKey } from "./calc";
import type { Row } from "./types";

export const KNOWN = new Set(["DEPRECIATING", "FULLY_DEPRECIATED", "NOT_STARTED"]);

/** Add one device to a group row. Book value only counts devices whose depreciation could be worked out. */
function add(row: Row, r: BookValueRow) {
  const inc = (k: string, v: number | null) => { if (v != null) row[k] = (row[k] as number) + v; };
  row.devices = (row.devices as number) + 1;
  inc("costEgp", r.costEgp);
  if (KNOWN.has(r.dep.state)) {
    inc("accumulatedEgp", r.accumulatedEgp);
    inc("bookValueEgp", r.bookValueEgp);
    if (r.costEgp != null && r.bookValueEgp != null) row.valuedCostEgp = (row.valuedCostEgp as number) + r.costEgp;
    if (r.dep.state === "FULLY_DEPRECIATED") row.fully = (row.fully as number) + 1;
  } else row.unknown = (row.unknown as number) + 1;
}
const blank = (extra: Row): Row => ({ ...extra, devices: 0, costEgp: 0, accumulatedEgp: 0, bookValueEgp: 0, fully: 0, unknown: 0, valuedCostEgp: 0 });

export function group(rows: BookValueRow[], key: (r: BookValueRow) => string, init: (r: BookValueRow) => Row): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, blank(init(r)));
    add(m.get(k)!, r);
  }
  return [...m.values()].map((g) => ({ ...g, pctLeft: pct(g.bookValueEgp as number, g.valuedCostEgp as number) }));
}

const pct = (book: number, cost: number) => (cost > 0 ? Math.round((book / cost) * 1000) / 10 : null);

export const totalsOf = (rows: Row[], label: Row): Row | undefined => {
  if (!rows.length) return undefined;
  const cost = sumKey(rows, "costEgp"), book = sumKey(rows, "bookValueEgp"), valued = sumKey(rows, "valuedCostEgp");
  return { ...label, devices: sumKey(rows, "devices"), costEgp: cost, accumulatedEgp: sumKey(rows, "accumulatedEgp"), bookValueEgp: book,
    pctLeft: pct(book, valued), valuedCostEgp: valued, fully: sumKey(rows, "fully"), unknown: sumKey(rows, "unknown") };
};

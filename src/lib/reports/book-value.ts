import "server-only";
import { bookValues, type BookValueRow } from "@/lib/assets/depreciation-server";
import { formatMoney, formatNumber } from "@/lib/format";
import { assets } from "@/db/schema";
import { plural, sumKey } from "./calc";
import { EGP_NOTE, facilityCond, missingRatesNote } from "./shared";
import type { Column, ReportContext, ReportResult, Row } from "./types";

const KNOWN = new Set(["DEPRECIATING", "FULLY_DEPRECIATED", "NOT_STARTED"]);

/** Add one device to a group row. Book value only counts devices whose depreciation could be worked out. */
function add(row: Row, r: BookValueRow) {
  const inc = (k: string, v: number | null) => { if (v != null) row[k] = (row[k] as number) + v; };
  row.devices = (row.devices as number) + 1;
  inc("costEgp", r.costEgp);
  if (KNOWN.has(r.dep.state)) {
    inc("accumulatedEgp", r.accumulatedEgp);
    inc("bookValueEgp", r.bookValueEgp);
    if (r.dep.state === "FULLY_DEPRECIATED") row.fully = (row.fully as number) + 1;
  } else row.unknown = (row.unknown as number) + 1;
}
const blank = (extra: Row): Row => ({ ...extra, devices: 0, costEgp: 0, accumulatedEgp: 0, bookValueEgp: 0, fully: 0, unknown: 0 });

function group(rows: BookValueRow[], key: (r: BookValueRow) => string, init: (r: BookValueRow) => Row): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, blank(init(r)));
    add(m.get(k)!, r);
  }
  return [...m.values()].map((g) => ({ ...g, pctLeft: (g.costEgp as number) > 0 ? Math.round(((g.bookValueEgp as number) / (g.costEgp as number)) * 1000) / 10 : null }));
}

const money: Column[] = [
  { key: "devices", header: "Devices", type: "int", width: 10 },
  { key: "costEgp", header: "Cost (EGP)", type: "egp", width: 18 },
  { key: "accumulatedEgp", header: "Depreciation so far (EGP)", type: "egp", width: 20 },
  { key: "bookValueEgp", header: "Book value (EGP)", type: "egp", width: 18 },
  { key: "pctLeft", header: "Value left", type: "pct", width: 11 },
  { key: "fully", header: "Fully depreciated", type: "int", width: 12 },
  { key: "unknown", header: "Not worked out", type: "int", width: 12 },
];
const totalsOf = (rows: Row[], label: Row): Row | undefined => {
  if (!rows.length) return undefined;
  const cost = sumKey(rows, "costEgp"), book = sumKey(rows, "bookValueEgp");
  return { ...label, devices: sumKey(rows, "devices"), costEgp: cost, accumulatedEgp: sumKey(rows, "accumulatedEgp"), bookValueEgp: book,
    pctLeft: cost > 0 ? Math.round((book / cost) * 1000) / 10 : null, fully: sumKey(rows, "fully"), unknown: sumKey(rows, "unknown") };
};

/** Book value report (wave 27): cost, depreciation so far and book value today, by facility, department and type. */
export async function bookValueReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const { rows, missing } = await bookValues(facilityCond(assets.facilityId, f, scope), today);
  const byFacility = group(rows, (r) => String(r.facilityId), (r) => ({ facility: r.facility })).sort((a, b) => String(a.facility).localeCompare(String(b.facility)));
  const byDept = group(rows, (r) => `${r.facilityId}:${r.departmentId ?? "none"}`, (r) => ({ facility: r.facility, department: r.department ?? "No department", departmentId: r.departmentId }))
    .sort((a, b) => String(a.facility).localeCompare(String(b.facility)) || (b.bookValueEgp as number) - (a.bookValueEgp as number));
  const byType = group(rows, (r) => String(r.typeId), (r) => ({ type: r.typeName, typeCode: r.typeCode }))
    .sort((a, b) => (b.bookValueEgp as number) - (a.bookValueEgp as number) || String(a.type).localeCompare(String(b.type)));
  const t = totalsOf(byFacility, {});
  const unknown = rows.filter((r) => !KNOWN.has(r.dep.state)).length;

  return {
    summary: [
      { label: "Devices", value: formatNumber(rows.length) },
      { label: "Cost", value: formatMoney(t?.costEgp ?? 0, "EGP", { compact: true }) },
      { label: "Book value", value: formatMoney(t?.bookValueEgp ?? 0, "EGP", { compact: true }) },
      { label: "Fully depreciated", value: formatNumber(rows.filter((r) => r.dep.state === "FULLY_DEPRECIATED").length) },
      { label: "Not worked out", value: formatNumber(unknown) },
    ],
    sections: [
      { key: "facilities", title: "By facility", columns: [{ key: "facility", header: "Facility", width: 30 }, ...money], rows: byFacility,
        totals: totalsOf(byFacility, { facility: plural(byFacility.length, "facility").replace("facilitys", "facilities") }), empty: "No devices in the chosen facility." },
      { key: "departments", title: "By department", columns: [
        { key: "facility", header: "Facility", width: 26 },
        { key: "department", header: "Department", width: 30, href: (r) => (r.departmentId != null ? `/assets?departmentId=${r.departmentId}` : null) },
        ...money], rows: byDept, totals: totalsOf(byDept, { facility: "All departments" }), empty: "No devices to group by department." },
      { key: "types", title: "By device type", columns: [
        { key: "type", header: "Device type", width: 34, href: (r) => `/catalogue/${r.typeCode}` },
        { key: "typeCode", header: "Code", width: 16, mono: true, only: "excel" },
        ...money], rows: byType, totals: totalsOf(byType, { type: "All types" }), empty: "No devices to group by type." },
    ],
    notes: [
      "Straight-line depreciation from the in-service date (the signed acceptance, else the install date, else the purchase date) over the useful life, down to the residual value. The device's own life and residual value win over its type's.",
      "Not worked out: devices without a purchase cost, an in-service date or a useful life. Their cost is in the cost total but not in the book value.",
      "Disposed devices are left out.",
      EGP_NOTE, missingRatesNote(missing),
    ].filter((x): x is string => !!x),
  };
}

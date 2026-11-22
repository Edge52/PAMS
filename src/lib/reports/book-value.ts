import "server-only";
import { bookValues } from "@/lib/assets/depreciation-server";
import { DEPRECIATION_METHOD_LABELS } from "@/lib/assets/depreciation";
import { getSetting } from "@/lib/settings";
import { formatMoney, formatNumber } from "@/lib/format";
import { assets } from "@/db/schema";
import { plural } from "./calc";
import { group, KNOWN, totalsOf } from "./book-value-calc";
import { EGP_NOTE, facilityCond, missingRatesNote } from "./shared";
import type { Column, ReportContext, ReportResult } from "./types";

const money: Column[] = [
  { key: "devices", header: "Devices", type: "int", width: 10 },
  { key: "costEgp", header: "Cost (EGP)", type: "egp", width: 18 },
  { key: "accumulatedEgp", header: "Depreciation so far (EGP)", type: "egp", width: 20 },
  { key: "bookValueEgp", header: "Book value (EGP)", type: "egp", width: 18 },
  { key: "pctLeft", header: "Value left", type: "pct", width: 11 },
  { key: "fully", header: "Fully depreciated", type: "int", width: 12 },
  { key: "unknown", header: "Not worked out", type: "int", width: 12 },
];

/** Book value report (wave 27): cost, depreciation so far and book value today, by facility, department and type. */
export async function bookValueReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const [{ rows, missing }, method] = await Promise.all([bookValues(facilityCond(assets.facilityId, f, scope), today), getSetting("depreciationMethod")]);
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
      `${DEPRECIATION_METHOD_LABELS[method]} from the in-service date (the signed acceptance, else the install date, else the purchase date) over the useful life, down to the residual value. The device's own life and residual value win over its type's. The method is set in Administration › Settings.`,
      "Not worked out: devices without a purchase cost, an in-service date or a useful life. Their cost is in the cost total but not in the book value.",
      "Disposed devices are left out.",
      EGP_NOTE, missingRatesNote(missing),
    ].filter((x): x is string => !!x),
  };
}

import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities } from "@/db/schema";
import { formatMoney, formatNumber, num } from "@/lib/format";
import { sumKey, sumToEgp } from "./calc";
import { EGP_NOTE, facilityCond, missingRatesNote, ratesFor } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

const grp = alias(deviceTypes, "rep_grp");
const cat = alias(deviceTypes, "rep_cat");

export const ASSET_STATUSES = ["IN_STOCK", "INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "DISPOSED"] as const;
const STATUS_HEADERS: Record<(typeof ASSET_STATUSES)[number], string> = {
  IN_STOCK: "In stock", INSTALLED: "Installed", IN_SERVICE: "In service", UNDER_MAINTENANCE: "Under maintenance",
  OUT_OF_SERVICE: "Out of service", DISPOSED: "Disposed",
};

export async function assetsByDepartmentReport({ filters: f, scope }: ReportContext): Promise<ReportResult> {
  // One row per department × status × category × currency; everything else is folded in JS.
  const categoryName = sql<string>`coalesce(${cat.name}, ${grp.name}, ${deviceTypes.name})`;
  const list = await db.select({
    facilityId: assets.facilityId, facility: facilities.name, facilityCode: facilities.code,
    departmentId: assets.departmentId, department: departments.name,
    status: assets.status, category: categoryName, currency: assets.currency,
    n: sql<number>`count(*)::int`,
    cost: sql<string>`coalesce(sum(${assets.purchaseCost}), 0)`,
  }).from(assets)
    .innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(grp, eq(grp.id, deviceTypes.parentId))
    .leftJoin(cat, eq(cat.id, grp.parentId))
    .where(and(facilityCond(assets.facilityId, f, scope)))
    .groupBy(assets.facilityId, facilities.name, facilities.code, assets.departmentId, departments.name, assets.status, categoryName, assets.currency);

  const rates = await ratesFor(list.map((r) => r.currency ?? "EGP"));
  const missing: string[] = [];
  const deptKey = (r: (typeof list)[number]) => `${r.facilityId}:${r.departmentId ?? "none"}`;

  type Acc = { row: Row; money: { amount: number; currency: string }[] };
  const depts = new Map<string, Acc>();
  const cats = new Map<string, Acc>();
  for (const r of list) {
    const amount = { amount: num(r.cost), currency: r.currency ?? "EGP" };
    const dk = deptKey(r);
    let d = depts.get(dk);
    if (!d) {
      d = { row: { facilityId: r.facilityId, departmentId: r.departmentId, facility: r.facility, department: r.department ?? "No department", total: 0 }, money: [] };
      for (const s of ASSET_STATUSES) d.row[s] = 0;
      depts.set(dk, d);
    }
    d.row[r.status] = (d.row[r.status] as number) + r.n;
    d.row.total = (d.row.total as number) + r.n;
    d.money.push(amount);

    const ck = `${dk}:${r.category}`;
    let c = cats.get(ck);
    if (!c) {
      c = { row: { facilityId: r.facilityId, departmentId: r.departmentId, facility: r.facility, department: r.department ?? "No department", category: r.category, count: 0, inUse: 0 }, money: [] };
      cats.set(ck, c);
    }
    c.row.count = (c.row.count as number) + r.n;
    if (r.status !== "DISPOSED") c.row.inUse = (c.row.inUse as number) + r.n;
    c.money.push(amount);
  }
  const finish = (a: Acc): Row => {
    const s = sumToEgp(a.money, rates);
    missing.push(...s.missing);
    return { ...a.row, costEgp: s.egp };
  };
  const byName = (a: Row, b: Row) =>
    String(a.facility).localeCompare(String(b.facility)) ||
    (a.departmentId == null ? 1 : 0) - (b.departmentId == null ? 1 : 0) ||
    String(a.department).localeCompare(String(b.department));
  const deptRows = [...depts.values()].map(finish).sort(byName);
  const catRows = [...cats.values()].map(finish)
    .sort((a, b) => byName(a, b) || String(a.category).localeCompare(String(b.category)));

  const drill = (r: Row) => (r.departmentId != null ? `/assets?departmentId=${r.departmentId}` : null);
  const totalAssets = sumKey(deptRows, "total");
  const totalCost = sumKey(deptRows, "costEgp");
  const statusTotals: Row = {};
  for (const s of ASSET_STATUSES) statusTotals[s] = sumKey(deptRows, s);

  return {
    summary: [
      { label: "Assets", value: formatNumber(totalAssets) },
      { label: "Departments", value: formatNumber(deptRows.length) },
      { label: "Total cost", value: formatMoney(totalCost, "EGP", { compact: true }) },
    ],
    sections: [
      {
        key: "departments", title: "By department and status",
        columns: [
          { key: "facility", header: "Facility", width: 28 },
          { key: "department", header: "Department", width: 30, href: drill },
          ...ASSET_STATUSES.map((s) => ({ key: s, header: STATUS_HEADERS[s], type: "int" as const, width: 12 })),
          { key: "total", header: "Total", type: "int", width: 10 },
          { key: "costEgp", header: "Total cost (EGP)", type: "egp", width: 18 },
        ],
        rows: deptRows,
        totals: deptRows.length ? { facility: "All departments", ...statusTotals, total: totalAssets, costEgp: totalCost } : undefined,
        empty: "No assets in the chosen facility yet. Register assets or receive a purchase order to see them here.",
      },
      {
        key: "categories", title: "By department and category",
        columns: [
          { key: "facility", header: "Facility", width: 28 },
          { key: "department", header: "Department", width: 30, href: drill },
          { key: "category", header: "Category", width: 34 },
          { key: "count", header: "Assets", type: "int", width: 10 },
          { key: "inUse", header: "Not disposed", type: "int", width: 12 },
          { key: "costEgp", header: "Cost (EGP)", type: "egp", width: 18 },
        ],
        rows: catRows,
        totals: catRows.length ? { facility: "All departments", count: sumKey(catRows, "count"), inUse: sumKey(catRows, "inUse"), costEgp: sumKey(catRows, "costEgp") } : undefined,
        empty: "No assets to group by category.",
      },
    ],
    notes: [EGP_NOTE, "Cost is the recorded purchase cost; assets without a cost count as zero.", missingRatesNote(missing)].filter((x): x is string => !!x),
  };
}

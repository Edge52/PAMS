import "server-only";
/**
 * Analytics › Cost (wave 40), database side: purchase order and invoice lines summed in SQL by date, currency,
 * supplier, top device category and department, then converted to EGP at each date's rate (./spend). COSR comes
 * from the existing service cost report, so the two never disagree.
 */
import { and, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { departments, deviceTypes, invoiceLines, invoices, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { num } from "@/lib/format";
import { loadFx } from "@/lib/server-utils";
import { serviceCostReport } from "@/lib/reports/service-cost";
import type { Row } from "@/lib/reports/types";
import type { Filters } from "./core";
import { inScope } from "./scope-server";
import { convertSpend, type SpendBasis, type SpendLine, type SpendRow } from "./spend";

/** Orders that commit money: approved or issued onwards (not drafts, waiting for approval or cancelled). */
export const COMMITTED_PO = ["APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED"] as const;
const ROW_LIMIT = 20_000;

/** The device type column is the chosen type or one under it (group or category). */
export function typeUnder(col: PgColumn | SQL, id: number | null): SQL | undefined {
  if (!id) return undefined;
  return sql`${col} in (select t.id from device_types t left join device_types p on p.id = t.parent_id where t.id = ${id} or t.parent_id = ${id} or p.parent_id = ${id})`;
}

export async function loadSpend(f: Filters, scope: number[], basis: SpendBasis): Promise<{ lines: SpendLine[]; missing: string[]; truncated: boolean }> {
  const p1 = alias(deviceTypes, "p1"), p2 = alias(deviceTypes, "p2");
  const catId = sql<number | null>`coalesce(${p2.id}, ${p1.id}, ${deviceTypes.id})`;
  const catName = sql<string | null>`coalesce(${p2.name}, ${p1.name}, ${deviceTypes.name})`;
  const common = [inScope(purchaseOrders.facilityId, scope), typeUnder(poLines.deviceTypeId, f.deviceTypeId),
    f.departmentId ? eq(poLines.destinationDepartmentId, f.departmentId) : undefined];

  let raw: { date: string; currency: string; amount: string; lines: number; supplierId: number | null; supplier: string | null; categoryId: number | null; category: string | null; departmentId: number | null; department: string | null }[];
  if (basis === "po") {
    const date = sql<string>`coalesce(${purchaseOrders.issueDate}, (${purchaseOrders.createdAt})::date)::text`;
    raw = await db.select({
      date, currency: purchaseOrders.currency, amount: sql<string>`sum(${poLines.quantity} * ${poLines.unitPrice})::text`, lines: sql<number>`count(*)::int`,
      supplierId: purchaseOrders.supplierId, supplier: suppliers.name, categoryId: catId, category: catName,
      departmentId: poLines.destinationDepartmentId, department: departments.name,
    }).from(poLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId)).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, poLines.deviceTypeId)).leftJoin(p1, eq(p1.id, deviceTypes.parentId)).leftJoin(p2, eq(p2.id, p1.parentId))
      .leftJoin(departments, eq(departments.id, poLines.destinationDepartmentId))
      .where(and(inArray(purchaseOrders.status, [...COMMITTED_PO]), ...common, sql`${date} between ${f.from} and ${f.to}`))
      .groupBy(date, purchaseOrders.currency, purchaseOrders.supplierId, suppliers.name, catId, catName, poLines.destinationDepartmentId, departments.name)
      .limit(ROW_LIMIT);
  } else {
    raw = await db.select({
      date: sql<string>`${invoices.invoiceDate}::text`, currency: invoices.currency, amount: sql<string>`sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice})::text`, lines: sql<number>`count(*)::int`,
      supplierId: invoices.supplierId, supplier: suppliers.name, categoryId: catId, category: catName,
      departmentId: poLines.destinationDepartmentId, department: departments.name,
    }).from(invoiceLines).innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId)).innerJoin(poLines, eq(poLines.id, invoiceLines.poLineId))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, poLines.deviceTypeId)).leftJoin(p1, eq(p1.id, deviceTypes.parentId)).leftJoin(p2, eq(p2.id, p1.parentId))
      .leftJoin(departments, eq(departments.id, poLines.destinationDepartmentId))
      .where(and(ne(invoices.status, "REJECTED"), ...common, gte(invoices.invoiceDate, f.from), lte(invoices.invoiceDate, f.to)))
      .groupBy(invoices.invoiceDate, invoices.currency, invoices.supplierId, suppliers.name, catId, catName, poLines.destinationDepartmentId, departments.name)
      .limit(ROW_LIMIT);
  }
  const rows: SpendRow[] = raw.map((r) => ({ ...r, amount: num(r.amount), lines: Number(r.lines) }));
  const fx = await loadFx();
  return { ...convertSpend(rows, fx), truncated: raw.length >= ROW_LIMIT };
}

export type CosrRow = { type: string; typeCode: string | null; devices: number; acquisitionEgp: number | null; serviceEgp: number; cosrYear: number | null };

/** COSR by device type from the service cost report (same rules, same figures). */
export async function cosrByType(f: Filters, scope: number[], today: string): Promise<{ rows: CosrRow[]; total: Row | null; notes: string[] }> {
  // The report works per hospital or over the scope; a single chosen hospital is already the scope.
  const result = await serviceCostReport({
    filters: { facilityId: f.facilityId, from: f.from, to: f.to, days: 0, grace: 0, projectStatus: "all" },
    scope, today,
  });
  const section = result.sections.find((s) => s.key === "types");
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const rows = (section?.rows ?? []).map((r) => ({
    type: String(r.type ?? ""), typeCode: typeof r.typeCode === "string" ? r.typeCode : null, devices: n(r.devices) ?? 0,
    acquisitionEgp: n(r.acquisitionEgp), serviceEgp: n(r.totalEgp) ?? 0, cosrYear: n(r.cosrYear),
  }));
  return { rows, total: section?.totals ?? null, notes: result.notes ?? [] };
}

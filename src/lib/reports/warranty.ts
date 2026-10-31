import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { addDays, daysBetween } from "@/lib/assets/dates";
import { formatMoney, formatNumber, num } from "@/lib/format";
import { humanize } from "@/lib/status";
import { sumToEgp, plural } from "./calc";
import { EGP_NOTE, facilityCond, missingRatesNote, ratesFor } from "./shared";
import type { ReportContext, ReportResult, Row } from "./types";

export async function warrantyExpiryReport({ filters: f, scope, today }: ReportContext): Promise<ReportResult> {
  const until = addDays(today, f.days);
  const list = await db.select({
    id: assets.id, tag: assets.assetTag, type: deviceTypes.name, typeCode: deviceTypes.code,
    manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, status: assets.status,
    facility: facilities.name, department: departments.name, warrantyEnd: assets.warrantyEnd,
    supplier: suppliers.name, supplierId: assets.supplierId, poNumber: purchaseOrders.number,
    cost: assets.purchaseCost, currency: assets.currency,
  }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, assets.facilityId))
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .leftJoin(suppliers, eq(suppliers.id, assets.supplierId))
    .leftJoin(poLines, eq(poLines.id, assets.poLineId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(and(
      facilityCond(assets.facilityId, f, scope),
      sql`${assets.status} <> 'DISPOSED'`,
      sql`${assets.warrantyEnd} between ${today} and ${until}`,
    ))
    .orderBy(asc(assets.warrantyEnd), asc(assets.assetTag));

  const rates = await ratesFor(list.map((a) => a.currency ?? "EGP"));
  const rows: Row[] = list.map((a) => ({
    id: a.id, tag: a.tag, type: a.type, makeModel: [a.manufacturer, a.model].filter(Boolean).join(" ") || null,
    serial: a.serial, status: humanize(a.status), facility: a.facility, department: a.department,
    warrantyEnd: a.warrantyEnd, daysLeft: a.warrantyEnd ? daysBetween(today, a.warrantyEnd) : null,
    supplier: a.supplier, supplierId: a.supplierId, poNumber: a.poNumber,
    cost: a.cost == null ? null : num(a.cost), currency: a.currency ?? "EGP",
  }));
  const money = sumToEgp(list.filter((a) => a.cost != null).map((a) => ({ amount: num(a.cost), currency: a.currency ?? "EGP" })), rates);
  const within30 = rows.filter((r) => typeof r.daysLeft === "number" && r.daysLeft <= 30).length;

  return {
    summary: [
      { label: `Ending in ${f.days} days`, value: formatNumber(rows.length) },
      { label: "Within 30 days", value: formatNumber(within30) },
      { label: "Value covered", value: formatMoney(money.egp, "EGP", { compact: true }) },
    ],
    sections: [{
      key: "warranties",
      columns: [
        { key: "tag", header: "Asset tag", width: 20, mono: true, subKey: "type", href: (r) => `/assets/${r.id}` },
        { key: "type", header: "Device type", width: 34, only: "excel" },
        { key: "makeModel", header: "Make and model", width: 28, subKey: "serial" },
        { key: "serial", header: "Serial number", width: 20, only: "excel" },
        { key: "status", header: "Status", width: 16 },
        { key: "facility", header: "Facility", width: 26 },
        { key: "department", header: "Department", width: 26 },
        { key: "warrantyEnd", header: "Warranty ends", type: "date", width: 14 },
        { key: "daysLeft", header: "Days left", type: "days", width: 10, tone: (r) => (typeof r.daysLeft === "number" && r.daysLeft <= 30 ? "warn" : null) },
        { key: "supplier", header: "Supplier", width: 28, subKey: "poNumber", href: (r) => (r.supplierId ? `/procurement/suppliers/${r.supplierId}` : null) },
        { key: "poNumber", header: "PO", width: 16, only: "excel" },
        { key: "cost", header: "Purchase cost", type: "money", currencyKey: "currency", width: 18 },
      ],
      rows,
      totals: rows.length ? { tag: plural(rows.length, "asset"), cost: null } : undefined,
      empty: `No warranties end in the next ${f.days} days. Try a longer window.`,
    }],
    notes: [EGP_NOTE, missingRatesNote(money.missing)].filter((x): x is string => !!x),
  };
}

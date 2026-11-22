/** Approved and paid invoices as CSV for the finance system (wave 10). */
import { todayISO } from "@/lib/format";
import { toCsv } from "@/lib/assets/csv"; // S11: the one shared escaping (formula triggers, quotes, line breaks)
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, invoiceLines, invoices, purchaseOrders, suppliers } from "@/db/schema";
import { scopeWhere } from "@/lib/assets/access";
import { facilityScope, requirePermission } from "@/lib/auth/session";


export async function GET() {
  const me = await requirePermission("prices.view");
  const scope = await facilityScope(me);
  const rows = await db.select({ i: invoices, po: purchaseOrders.number, supplier: suppliers.name, taxId: suppliers.taxId, facility: facilities.name,
    total: sql<string>`(select sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice}) from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id})` })
    .from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .leftJoin(facilities, eq(facilities.id, purchaseOrders.facilityId))
    .where(and(inArray(invoices.status, ["APPROVED", "PAID"]), scopeWhere(purchaseOrders.facilityId, scope))).orderBy(asc(invoices.invoiceDate));
  const head = ["Invoice", "Supplier invoice no", "Supplier", "Supplier tax ID", "Hospital", "PO", "Invoice date", "Due date", "Currency", "Amount", "Delay penalty", "Payable", "Status", "Approved by", "Paid on", "Payment reference"];
  const body = rows.map((r) => [r.i.number, r.i.supplierInvoiceNo, r.supplier, r.taxId, r.facility, r.po, r.i.invoiceDate, r.i.dueDate, r.i.currency, Number(r.total ?? 0).toFixed(2), Number(r.i.delayPenalty ?? 0).toFixed(2), Math.max(0, Number(r.total ?? 0) - Number(r.i.delayPenalty ?? 0)).toFixed(2), r.i.status, r.i.approvedByName, r.i.paidAt, r.i.paymentReference]);
  return new Response(toCsv(head, body), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="invoices-${todayISO()}.csv"` } });
}

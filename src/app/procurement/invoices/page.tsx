import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, PageHeader, Panel, StatusBadge, TabLinks } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier invoices" };

const TABS = [
  { key: "decide", label: "To decide", statuses: ["MATCHED", "EXCEPTION"] },
  { key: "pay", label: "To pay", statuses: ["APPROVED"] },
  { key: "paid", label: "Paid", statuses: ["PAID"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const rows = await db.select({ i: invoices, po: purchaseOrders.number, supplier: suppliers.name, total: sql<string>`(select sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice}) from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id})` })
    .from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .where(and(inArray(invoices.status, [...tab.statuses]), scopeWhere(purchaseOrders.facilityId, scope))).orderBy(desc(invoices.invoiceDate)).limit(300);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Supplier invoices" description="Each invoice is matched against what its purchase order ordered and what was received. Record one from the PO's page."
        actions={<Link href="/procurement/invoices/export" prefetch={false} className="text-sm font-semibold text-primary hover:underline">Export for finance (CSV)</Link>} />
      <Notice sp={sp} />
      <TabLinks active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/procurement/invoices?tab=${t.key}` }))} />
      {rows.length === 0 ? <EmptyState title="Nothing here">No invoices {tab.label.toLowerCase()}.</EmptyState> : (
        <Panel padded={false} className="mt-4">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">PO</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.i.id} className="border-t border-line">
                <td className="px-3 py-2"><Link href={`/procurement/invoices/${r.i.id}`} className="font-mono font-semibold text-primary hover:underline">{r.i.number}</Link><div className="text-xs text-muted">{r.i.supplierInvoiceNo}</div></td>
                <td className="px-3 py-2">{r.supplier}</td><td className="px-3 py-2 font-mono text-xs">{r.po}</td><td className="px-3 py-2">{formatDate(r.i.invoiceDate)}</td>
                <td className={`px-3 py-2 ${r.i.dueDate && r.i.dueDate < today && r.i.status !== "PAID" ? "text-danger" : ""}`}>{formatDate(r.i.dueDate)}</td>
                <td className="px-3 py-2 text-right">{formatMoney(r.total, r.i.currency)}</td><td className="px-3 py-2"><StatusBadge value={r.i.status} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}
    </>
  );
}

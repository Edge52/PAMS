import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, PageHeader, StatusBadge, TabLinks } from "@/components/ui";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { SavedFilters } from "@/components/saved-filters";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supplier invoices" };
const SORT_KEYS = ["number", "supplier", "po", "date", "due", "amount", "status"] as const;

const TABS = [
  { key: "decide", label: "To decide", statuses: ["MATCHED", "EXCEPTION"] },
  { key: "pay", label: "To pay", statuses: ["APPROVED"] },
  { key: "paid", label: "Paid", statuses: ["PAID"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("prices.view"); // audit R9: offers, prices and invoices
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const where = and(inArray(invoices.status, [...tab.statuses]), scopeWhere(purchaseOrders.facilityId, scope));
  // B6: paged instead of stopping at 300 rows without a word.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).where(where);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const sort = tableSort(sp, SORT_KEYS);
  const total = sql<string>`(select sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice}) from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id})`;
  const rows = await db.select({ i: invoices, po: purchaseOrders.number, supplier: suppliers.name, total })
    .from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId)).innerJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .where(where).orderBy(...sqlOrder(sort, { number: invoices.number, supplier: suppliers.name, po: purchaseOrders.number, date: invoices.invoiceDate, due: invoices.dueDate, amount: total, status: invoices.status },
      [desc(invoices.invoiceDate)], [desc(invoices.id)])).limit(PAGE_SIZE).offset(paging.offset);
  const today = todayISO();
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "number", label: "Invoice", sort: true, cell: (r) => <><Link href={`/procurement/invoices/${r.i.id}`} className="font-mono font-semibold text-primary hover:underline">{r.i.number}</Link><div className="text-xs text-muted">{r.i.supplierInvoiceNo}</div></> },
    { key: "supplier", label: "Supplier", sort: true, cell: (r) => r.supplier },
    { key: "po", label: "PO", sort: true, optional: true, cellClassName: "font-mono text-xs", cell: (r) => r.po },
    { key: "date", label: "Date", sort: true, className: "whitespace-nowrap", cell: (r) => formatDate(r.i.invoiceDate) },
    { key: "due", label: "Due", sort: true, optional: true, className: "whitespace-nowrap",
      cell: (r) => <span className={r.i.dueDate && r.i.dueDate < today && r.i.status !== "PAID" ? "text-danger" : ""}>{formatDate(r.i.dueDate)}</span> },
    { key: "amount", label: "Amount", sort: true, align: "right", className: "whitespace-nowrap", cell: (r) => formatMoney(r.total, r.i.currency) },
    { key: "status", label: "Status", sort: true, cell: (r) => <StatusBadge value={r.i.status} /> },
  ];
  return (
    <>
      <PageHeader title="Supplier invoices" description="Each invoice is matched against what its purchase order ordered and what was received. Record one from the PO's page."
        actions={<Link href="/procurement/invoices/export" prefetch={false} className="text-sm font-semibold text-primary hover:underline">Export for finance (CSV)</Link>} />
      <Notice sp={sp} />
      <SavedFilters page="invoices" />
      <TabLinks active={tab.key} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/procurement/invoices?tab=${t.key}` }))} />
      <div className="mt-4">
        <DataTable id="invoices" label="Supplier invoices" path="/procurement/invoices" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.i.id} columns={columns}
          empty={<EmptyState title="Nothing here">No invoices {tab.label.toLowerCase()}.</EmptyState>}
          footer={<ListPager paging={paging} path="/procurement/invoices" sp={sp} what="invoices" />} />
      </div>
    </>
  );
}

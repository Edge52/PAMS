import Link from "next/link";
import { AutoSubmit } from "@/components/auto-submit";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { poLines, projects, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { DaysLeft, Progress } from "@/components/procurement/bits";

import { rateToEgp } from "@/lib/server-utils";
import { options } from "@/lib/procurement/labels";
import { PO_STATUSES, type PoStatus } from "@/lib/procurement/po-status";
import { poTotals } from "@/lib/procurement/server";
import { SavedFilters } from "@/components/saved-filters";
import { ListPager } from "@/components/list-pager";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { CURRENCIES } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { seesPrices, shownMoney } from "@/lib/auth/prices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders" };

const OPEN: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; supplierId?: string; q?: string; sort?: string; dir?: string; page?: string }> }) {
  const me = await requirePermission("procurement.view");
  const prices = seesPrices(me.role); // audit R9
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const scope = await facilityScope(me);
  const where: SQL[] = [];
  const inScope = scopeWhere(purchaseOrders.facilityId, scope);
  if (inScope) where.push(inScope);
  if (status === "open") where.push(sql`${purchaseOrders.status} in ${OPEN}`);
  else if ((PO_STATUSES as string[]).includes(status)) where.push(eq(purchaseOrders.status, status as PoStatus));
  const supplierId = Number(sp.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) where.push(eq(purchaseOrders.supplierId, supplierId));
  const q = sp.q?.trim();
  if (q) where.push(or(ilike(purchaseOrders.number, `%${q}%`), ilike(suppliers.name, `%${q}%`), ilike(projects.code, `%${q}%`))!);

  // Wave 41: counted, sorted and paged in the database. Value sorts in EGP (latest saved rates) so mixed currencies
  // compare; received sorts by the share of units received.
  const sort = tableSort(sp, SORT_KEYS);
  const whereSql = where.length ? and(...where) : undefined;
  const egpRate = new Map(await Promise.all(CURRENCIES.map(async (c) => [c as string, await rateToEgp(c)] as const)));
  const rateCase = sql.join([sql`case ${purchaseOrders.currency}`, ...[...egpRate].map(([c, r]) => sql`when ${c} then ${r ?? 0}::numeric`), sql`else 0 end`], sql` `);
  const lineValue = sql`(select coalesce(sum(${poLines.quantity} * ${poLines.unitPrice}), 0) from ${poLines} where ${poLines.poId} = ${purchaseOrders.id})`;
  const valueEgp = sql`(${lineValue} * ${rateCase})`;
  const receivedShare = sql`(select coalesce(sum(least(${poLines.receivedQty}, ${poLines.quantity}))::numeric / nullif(sum(${poLines.quantity}), 0), 0) from ${poLines} where ${poLines.poId} = ${purchaseOrders.id})`;
  const fromPo = () => db.select({ n: sql<number>`count(*)::int` }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId));
  const [[{ n }], supplierList, anyPo, byCurrency] = await Promise.all([
    fromPo().where(whereSql),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(inScope).limit(1),
    // The totals line adds up every matching order, not just this page.
    db.select({ currency: purchaseOrders.currency, v: sql<string>`coalesce(sum(${lineValue}), 0)` }).from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(whereSql).groupBy(purchaseOrders.currency),
  ]);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const rows = await db.select({
    id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
    issueDate: purchaseOrders.issueDate, expectedDelivery: purchaseOrders.expectedDelivery,
    supplierId: purchaseOrders.supplierId, supplier: suppliers.name, projectId: purchaseOrders.projectId, project: projects.code,
  }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(whereSql)
    .orderBy(...sqlOrder(sort, { number: purchaseOrders.number, supplier: suppliers.name, project: projects.code, status: purchaseOrders.status, value: valueEgp, delivery: purchaseOrders.expectedDelivery, received: receivedShare },
      [sql`${purchaseOrders.expectedDelivery} asc nulls last`], [desc(purchaseOrders.id)]))
    .limit(paging.size).offset(paging.offset);
  const totals = await poTotals(rows.map((r) => r.id));
  const filtered = status !== "open" || Boolean(sp.supplierId) || Boolean(q);

  return (
    <>
      <PageHeader title="Purchase orders" description="Orders placed with suppliers, what has arrived and what is still outstanding."
        actions={can(me.role, "po.create") ? <LinkButton href="/procurement/purchase-orders/new" variant="primary">New purchase order</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <AutoSubmit />
        {sort && <input type="hidden" name="sort" value={sort.key} />}{sort?.dir === "desc" && <input type="hidden" name="dir" value="desc" />}
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search PO number, supplier or project" /></label>
        <label><span className="sr-only">Status</span>
          <Select name="status" defaultValue={status} className="w-auto" options={[{ value: "open", label: "Open orders" }, { value: "all", label: "All statuses" }, ...options(PO_STATUSES)]} /></label>
        <label><span className="sr-only">Supplier</span>
          <Select name="supplierId" defaultValue={sp.supplierId ?? ""} placeholder="All suppliers" options={supplierList.map((s) => ({ value: s.id, label: s.name }))} className="w-auto max-w-56" /></label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/purchase-orders" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      <SavedFilters page="purchase-orders" />

      {rows.length === 0 ? (
        anyPo.length ? (
          <EmptyState title="No purchase orders match" action={<LinkButton href="/procurement/purchase-orders?status=all">Show all orders</LinkButton>}>Try another status or search.</EmptyState>
        ) : (
          <EmptyState title="No purchase orders yet" action={can(me.role, "po.create") ? <LinkButton href="/procurement/purchase-orders/new" variant="primary">Raise a purchase order</LinkButton> : undefined}>
            Recommend an award on a project&apos;s comparison; once it is approved, raise the purchase order from it.
          </EmptyState>
        )
      ) : (
        <>
        <DataTable id="purchase-orders" label="Purchase orders" path="/procurement/purchase-orders" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.id}
          columns={poColumns(totals, prices)} footer={<ListPager paging={paging} path="/procurement/purchase-orders" sp={sp} what="orders" />} />
        {/* Wave 19: the orders listed, added up in one currency. */}
        {(() => {
          const by = new Map(byCurrency.map((r) => [r.currency, Number(r.v)]));
          const parts = [...by].map(([c, v]) => shownMoney(prices, v, c));
          const missing = [...by.keys()].filter((c) => egpRate.get(c) == null);
          const egp = [...by].reduce((t, [c, v]) => t + v * (egpRate.get(c) ?? 0), 0);
          return (
            <p className="mt-2 text-right text-sm text-muted">
              {n} order{n === 1 ? "" : "s"}: {parts.join(" + ")}
              {by.size > 1 || !by.has("EGP") ? <> · <b className="text-ink">{shownMoney(prices, egp, "EGP")}</b> at the latest saved exchange rates{missing.length ? ` (no rate for ${missing.join(", ")})` : ""}</> : null}
            </p>
          );
        })()}
        </>
      )}
    </>
  );
}

const SORT_KEYS = ["number", "supplier", "project", "status", "value", "delivery", "received"] as const;
type PoRow = { id: number; number: string; status: string; currency: string; expectedDelivery: string | null; supplierId: number; supplier: string; projectId: number | null; project: string | null };

function poColumns(totals: Awaited<ReturnType<typeof poTotals>>, prices: boolean): Column<PoRow>[] {
  return [
    { key: "number", label: "Number", sort: true, className: "whitespace-nowrap",
      cell: (r) => <Link href={`/procurement/purchase-orders/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link> },
    { key: "supplier", label: "Supplier", sort: true, cell: (r) => <Link href={`/procurement/suppliers/${r.supplierId}`} className="hover:text-primary">{r.supplier}</Link> },
    { key: "project", label: "Project", sort: true, optional: true, cell: (r) => (r.projectId ? <Link href={`/procurement/${r.projectId}`} className="hover:text-primary">{r.project}</Link> : "—") },
    { key: "status", label: "Status", sort: true, cell: (r) => <StatusBadge value={r.status} /> },
    { key: "value", label: "Value", sort: true, align: "right", optional: true, className: "whitespace-nowrap", cell: (r) => shownMoney(prices, totals.get(r.id)?.value ?? 0, r.currency) },
    { key: "delivery", label: "Expected delivery", sort: true, optional: true, className: "whitespace-nowrap",
      cell: (r) => (r.expectedDelivery ? <DaysLeft date={r.expectedDelivery} closedLabel={OPEN.includes(r.status as PoStatus) ? undefined : "—"} /> : "—") },
    { key: "received", label: "Received", sort: true, optional: true,
      cell: (r) => { const t = totals.get(r.id); return <><Progress pct={t && t.ordered ? Math.round((t.received / t.ordered) * 100) : 0} />
        <span className="text-xs text-muted">{t?.received ?? 0} of {t?.ordered ?? 0} units</span></>; } },
  ];
}

import Link from "next/link";
import { AutoSubmit } from "@/components/auto-submit";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { projects, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, THead } from "@/components/ui";
import { DaysLeft, Progress } from "@/components/procurement/bits";
import { formatMoney } from "@/lib/format";
import { rateToEgp } from "@/lib/server-utils";
import { options } from "@/lib/procurement/labels";
import { PO_STATUSES, type PoStatus } from "@/lib/procurement/po-status";
import { poTotals } from "@/lib/procurement/server";
import { SortTh } from "@/components/ui/sort-th";
import { SavedFilters } from "@/components/saved-filters";
import { parseSort, sortRows } from "@/lib/list";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders" };

const OPEN: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; supplierId?: string; q?: string; sort?: string; dir?: string }> }) {
  const me = await requirePermission("procurement.view");
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

  const [found, supplierList, anyPo] = await Promise.all([
    db.select({
      id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
      issueDate: purchaseOrders.issueDate, expectedDelivery: purchaseOrders.expectedDelivery,
      supplierId: purchaseOrders.supplierId, supplier: suppliers.name, projectId: purchaseOrders.projectId, project: projects.code,
    }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(where.length ? and(...where) : undefined).orderBy(sql`${purchaseOrders.expectedDelivery} asc nulls last`, desc(purchaseOrders.id)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(inScope).limit(1),
  ]);
  const totals = await poTotals(found.map((r) => r.id));
  const egpRate = new Map(await Promise.all([...new Set(found.map((r) => r.currency))].map(async (c) => [c, await rateToEgp(c)] as const)));
  // Wave 21: a heading can re-sort the list. Value sorts in EGP so mixed currencies compare.
  const sort = parseSort(sp, ["number", "supplier", "project", "status", "value", "delivery", "received"] as const);
  const rows = sortRows(found, sort, {
    number: (r) => r.number, supplier: (r) => r.supplier, project: (r) => r.project, status: (r) => r.status,
    value: (r) => (totals.get(r.id)?.value ?? 0) * (egpRate.get(r.currency) ?? 1), delivery: (r) => r.expectedDelivery,
    received: (r) => { const t = totals.get(r.id); return t && t.ordered ? t.received / t.ordered : 0; },
  });
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
      <SavedFilters />

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
        <Table>
          <THead><tr><SortTh k="number">Number</SortTh><SortTh k="supplier">Supplier</SortTh><SortTh k="project">Project</SortTh><SortTh k="status">Status</SortTh><SortTh k="value" align="right">Value</SortTh><SortTh k="delivery">Expected delivery</SortTh><SortTh k="received">Received</SortTh></tr></THead>
          <tbody>
            {rows.map((r) => {
              const t = totals.get(r.id);
              const open = OPEN.includes(r.status as PoStatus);
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap"><Link href={`/procurement/purchase-orders/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link></Td>
                  <Td><Link href={`/procurement/suppliers/${r.supplierId}`} className="hover:text-primary">{r.supplier}</Link></Td>
                  <Td>{r.projectId ? <Link href={`/procurement/${r.projectId}`} className="hover:text-primary">{r.project}</Link> : "—"}</Td>
                  <Td><StatusBadge value={r.status} /></Td>
                  <Td align="right" className="whitespace-nowrap">{formatMoney(t?.value ?? 0, r.currency)}</Td>
                  <Td className="whitespace-nowrap">{r.expectedDelivery ? <DaysLeft date={r.expectedDelivery} closedLabel={open ? undefined : "—"} /> : "—"}</Td>
                  <Td><Progress pct={t && t.ordered ? Math.round((t.received / t.ordered) * 100) : 0} />
                    <span className="text-xs text-muted">{t?.received ?? 0} of {t?.ordered ?? 0} units</span></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {/* Wave 19: the orders listed, added up in one currency. */}
        {(() => {
          const by = new Map<string, number>();
          for (const r of rows) by.set(r.currency, (by.get(r.currency) ?? 0) + (totals.get(r.id)?.value ?? 0));
          const parts = [...by].map(([c, v]) => formatMoney(v, c));
          const missing = [...by.keys()].filter((c) => egpRate.get(c) == null);
          const egp = [...by].reduce((t, [c, v]) => t + v * (egpRate.get(c) ?? 0), 0);
          return (
            <p className="mt-2 text-right text-sm text-muted">
              {rows.length} order{rows.length === 1 ? "" : "s"}: {parts.join(" + ")}
              {by.size > 1 || !by.has("EGP") ? <> · <b className="text-ink">{formatMoney(egp, "EGP")}</b> at the latest saved exchange rates{missing.length ? ` (no rate for ${missing.join(", ")})` : ""}</> : null}
            </p>
          );
        })()}
        </>
      )}
    </>
  );
}

import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { projects, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft, Progress } from "@/components/procurement/bits";
import { formatMoney } from "@/lib/format";
import { options } from "@/lib/procurement/labels";
import { PO_STATUSES, type PoStatus } from "@/lib/procurement/po-status";
import { poTotals } from "@/lib/procurement/server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders" };

const OPEN: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"];

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; supplierId?: string; q?: string }> }) {
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

  const [rows, supplierList, anyPo] = await Promise.all([
    db.select({
      id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, currency: purchaseOrders.currency,
      issueDate: purchaseOrders.issueDate, expectedDelivery: purchaseOrders.expectedDelivery,
      supplierId: purchaseOrders.supplierId, supplier: suppliers.name, projectId: purchaseOrders.projectId, project: projects.code,
    }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(where.length ? and(...where) : undefined).orderBy(sql`${purchaseOrders.expectedDelivery} asc nulls last`, desc(purchaseOrders.id)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(inScope).limit(1),
  ]);
  const totals = await poTotals(rows.map((r) => r.id));
  const filtered = status !== "open" || Boolean(sp.supplierId) || Boolean(q);

  return (
    <>
      <PageHeader title="Purchase orders" description="Orders placed with suppliers, what has arrived and what is still outstanding."
        actions={can(me.role, "po.create") ? <LinkButton href="/procurement/purchase-orders/new" variant="primary">New purchase order</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search PO number, supplier or project" /></label>
        <label><span className="sr-only">Status</span>
          <Select name="status" defaultValue={status} className="w-auto" options={[{ value: "open", label: "Open orders" }, { value: "all", label: "All statuses" }, ...options(PO_STATUSES)]} /></label>
        <label><span className="sr-only">Supplier</span>
          <Select name="supplierId" defaultValue={sp.supplierId ?? ""} placeholder="All suppliers" options={supplierList.map((s) => ({ value: s.id, label: s.name }))} className="w-auto max-w-56" /></label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/purchase-orders" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        anyPo.length ? (
          <EmptyState title="No purchase orders match" action={<LinkButton href="/procurement/purchase-orders?status=all">Show all orders</LinkButton>}>Try another status or search.</EmptyState>
        ) : (
          <EmptyState title="No purchase orders yet" action={can(me.role, "po.create") ? <LinkButton href="/procurement/purchase-orders/new" variant="primary">Raise a purchase order</LinkButton> : undefined}>
            Recommend an award on a project&apos;s comparison; once it is approved, raise the purchase order from it.
          </EmptyState>
        )
      ) : (
        <Table>
          <THead><tr><Th>Number</Th><Th>Supplier</Th><Th>Project</Th><Th>Status</Th><Th align="right">Value</Th><Th>Expected delivery</Th><Th>Received</Th></tr></THead>
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
      )}
    </>
  );
}

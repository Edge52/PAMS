import Link from "next/link";
import { and, asc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { offers, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { options, SUPPLIER_TYPES, type SupplierType } from "@/lib/procurement/labels";
import { poTotals, sumInCurrency } from "@/lib/procurement/server";
import { Stars } from "@/components/procurement/stars";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; show?: string }> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const where: SQL[] = [];
  if (sp.show !== "all") where.push(eq(suppliers.active, true));
  if (sp.type && (SUPPLIER_TYPES as readonly string[]).includes(sp.type)) where.push(eq(suppliers.type, sp.type as SupplierType));
  const q = sp.q?.trim();
  if (q) where.push(or(ilike(suppliers.name, `%${q}%`), sql`array_to_string(${suppliers.brands}, ',') ilike ${`%${q}%`}`, ilike(suppliers.contactName, `%${q}%`))!);

  const rows = await db.select({
    s: suppliers,
    offerCount: sql<number>`(select count(*)::int from ${offers} where ${offers.supplierId} = ${suppliers.id})`,
    awardedCount: sql<number>`(select count(*)::int from ${offers} where ${offers.supplierId} = ${suppliers.id} and ${offers.status} = 'AWARDED')`,
  }).from(suppliers).where(where.length ? and(...where) : undefined).orderBy(asc(suppliers.name));

  const pos = rows.length ? await db.select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId, currency: purchaseOrders.currency })
    .from(purchaseOrders).where(ne(purchaseOrders.status, "CANCELLED")) : [];
  const totals = await poTotals(pos.map((p) => p.id));
  const ordered = new Map<number, { total: number | null; partial: number }>();
  for (const r of rows) {
    const mine = pos.filter((p) => p.supplierId === r.s.id);
    if (mine.length) ordered.set(r.s.id, await sumInCurrency(mine.map((p) => ({ amount: totals.get(p.id)?.value ?? 0, currency: p.currency })), "EGP"));
  }
  const filtered = Boolean(q || sp.type || sp.show === "all");

  return (
    <>
      <PageHeader title="Suppliers" description="Agents and distributors, the brands they represent, and how they have performed on your tenders."
        actions={can(me.role, "suppliers.edit") ? <LinkButton href="/procurement/suppliers/new" variant="primary">Add supplier</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search name, brand or contact" /></label>
        <label><span className="sr-only">Type</span>
          <Select name="type" defaultValue={sp.type ?? ""} placeholder="All types" options={options(SUPPLIER_TYPES)} className="w-auto" /></label>
        <label className="flex items-center gap-2 px-1 py-1.5 text-sm">
          <input type="checkbox" name="show" value="all" defaultChecked={sp.show === "all"} className="size-4 accent-[var(--color-primary)]" />Include inactive</label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/suppliers" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        filtered ? <EmptyState title="No suppliers match" action={<LinkButton href="/procurement/suppliers">Show all suppliers</LinkButton>}>Try another name or brand.</EmptyState>
          : <EmptyState title="No suppliers yet" action={can(me.role, "suppliers.edit") ? <LinkButton href="/procurement/suppliers/new" variant="primary">Add the first supplier</LinkButton> : undefined}>
            Add the local agents and distributors you invite to tenders, with the brands they represent.</EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Supplier</Th><Th>Type</Th><Th>Brands</Th><Th>Contact</Th><Th>Rating</Th><Th align="right">Offers</Th><Th align="right">Awarded</Th><Th align="right">Ordered (EGP)</Th></tr></THead>
          <tbody>
            {rows.map(({ s, offerCount, awardedCount }) => {
              const o = ordered.get(s.id);
              return (
                <tr key={s.id} className={s.active ? undefined : "text-muted"}>
                  <Td className="min-w-48"><Link href={`/procurement/suppliers/${s.id}`} className="font-semibold text-primary hover:underline">{s.name}</Link>
                    {!s.active && <span className="ml-2 text-xs">(inactive)</span>}{s.country && <span className="block text-xs text-muted">{s.country}</span>}</Td>
                  <Td><StatusBadge value={s.type} /></Td>
                  <Td className="max-w-64 text-sm">{s.brands?.length ? s.brands.join(", ") : <span className="text-faint">—</span>}</Td>
                  <Td className="text-sm">{s.contactName ?? "—"}{s.phone && <span className="block text-xs text-muted">{s.phone}</span>}</Td>
                  <Td><Stars value={s.rating} /></Td>
                  <Td align="right">{offerCount}</Td>
                  <Td align="right">{awardedCount}</Td>
                  <Td align="right" className="whitespace-nowrap">{o ? (o.total == null ? `${formatMoney(o.partial, "EGP", { compact: true })}*` : formatMoney(o.total, "EGP", { compact: true })) : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}

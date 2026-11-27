import Link from "next/link";
import { AutoSubmit } from "@/components/auto-submit";
import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { offers, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { formatMoney } from "@/lib/format";
import { options, SUPPLIER_TYPES, type SupplierType } from "@/lib/procurement/labels";
import { poTotals, sumInCurrency } from "@/lib/procurement/server";
import { Stars } from "@/components/procurement/stars";
import { SavedFilters } from "@/components/saved-filters";
import { sortRows } from "@/lib/list";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; show?: string; sort?: string; dir?: string }> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const where: SQL[] = [];
  if (sp.show !== "all") where.push(eq(suppliers.active, true));
  if (sp.type && (SUPPLIER_TYPES as readonly string[]).includes(sp.type)) where.push(eq(suppliers.type, sp.type as SupplierType));
  const q = sp.q?.trim();
  if (q) where.push(or(ilike(suppliers.name, `%${q}%`), sql`array_to_string(${suppliers.brands}, ',') ilike ${`%${q}%`}`, ilike(suppliers.contactName, `%${q}%`))!);

  // Wave 38: the sort key is checked against this list; all but "ordered" (worked out below in EGP) sort in the query.
  const sort = tableSort(sp, SORT_KEYS);
  const offerCount = sql<number>`(select count(*)::int from ${offers} where ${offers.supplierId} = ${suppliers.id})`;
  const awardedCount = sql<number>`(select count(*)::int from ${offers} where ${offers.supplierId} = ${suppliers.id} and ${offers.status} = 'AWARDED')`;
  const way = sort?.dir === "desc" ? desc : asc;
  const sqlOrder = { name: [way(suppliers.name)], type: [way(suppliers.type), asc(suppliers.name)],
    rating: [sort?.dir === "desc" ? sql`${suppliers.rating} desc nulls last` : sql`${suppliers.rating} asc nulls last`, asc(suppliers.name)],
    offers: [way(offerCount), asc(suppliers.name)], awarded: [way(awardedCount), asc(suppliers.name)], ordered: [asc(suppliers.name)] }[sort?.key ?? "name"];
  const found = await db.select({ s: suppliers, offerCount, awardedCount })
    .from(suppliers).where(where.length ? and(...where) : undefined).orderBy(...sqlOrder);

  const pos = found.length ? await db.select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId, currency: purchaseOrders.currency })
    .from(purchaseOrders).where(ne(purchaseOrders.status, "CANCELLED")) : [];
  const totals = await poTotals(pos.map((p) => p.id));
  const ordered = new Map<number, { total: number | null; partial: number }>();
  for (const r of found) {
    const mine = pos.filter((p) => p.supplierId === r.s.id);
    if (mine.length) ordered.set(r.s.id, await sumInCurrency(mine.map((p) => ({ amount: totals.get(p.id)?.value ?? 0, currency: p.currency })), "EGP"));
  }
  const rows = sort?.key === "ordered" ? sortRows(found, { key: "ordered", dir: sort.dir }, { ordered: (r) => ordered.get(r.s.id)?.total ?? 0 }) : found;
  const filtered = Boolean(q || sp.type || sp.show === "all");

  return (
    <>
      <PageHeader title="Suppliers" description="Agents and distributors, the brands they represent, and how they have performed on your tenders."
        actions={<><LinkButton href="/procurement/suppliers/documents">Expiring documents</LinkButton>{can(me.role, "suppliers.edit") && <><LinkButton href="/admin/imports/suppliers">Import from Excel</LinkButton><LinkButton href="/procurement/suppliers/new" variant="primary">Add supplier</LinkButton></>}</>} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <AutoSubmit />
        {sort && <input type="hidden" name="sort" value={sort.key} />}{sort?.dir === "desc" && <input type="hidden" name="dir" value="desc" />}
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search name, brand or contact" /></label>
        <label><span className="sr-only">Type</span>
          <Select name="type" defaultValue={sp.type ?? ""} placeholder="All types" options={options(SUPPLIER_TYPES)} className="w-auto" /></label>
        <label className="flex items-center gap-2 px-1 py-1.5 text-sm">
          <input type="checkbox" name="show" value="all" defaultChecked={sp.show === "all"} className="size-4 accent-[var(--color-primary)]" />Include inactive</label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/suppliers" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      <SavedFilters />
      {rows.length === 0 ? (
        filtered ? <EmptyState title="No suppliers match" action={<LinkButton href="/procurement/suppliers">Show all suppliers</LinkButton>}>Try another name or brand.</EmptyState>
          : <EmptyState title="No suppliers yet" action={can(me.role, "suppliers.edit") ? <LinkButton href="/procurement/suppliers/new" variant="primary">Add the first supplier</LinkButton> : undefined}>
            Add the local agents and distributors you invite to tenders, with the brands they represent.</EmptyState>
      ) : (
        <DataTable id="suppliers" label="Suppliers" path="/procurement/suppliers" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.s.id}
          rowClassName={(r) => (r.s.active ? undefined : "text-muted")} columns={supplierColumns(ordered)} />
      )}
    </>
  );
}

const SORT_KEYS = ["name", "type", "rating", "offers", "awarded", "ordered"] as const;
type SupplierRow = { s: typeof suppliers.$inferSelect; offerCount: number; awardedCount: number };

function supplierColumns(ordered: Map<number, { total: number | null; partial: number }>): Column<SupplierRow>[] {
  return [
    { key: "name", label: "Supplier", sort: true, className: "min-w-48",
      cell: ({ s }) => <><Link href={`/procurement/suppliers/${s.id}`} className="font-semibold text-primary hover:underline">{s.name}</Link>
        {!s.active && <span className="ml-2 text-xs">(inactive)</span>}{s.country && <span className="block text-xs text-muted">{s.country}</span>}</> },
    { key: "type", label: "Type", sort: true, cell: ({ s }) => <StatusBadge value={s.type} /> },
    { key: "brands", label: "Brands", optional: true, cellClassName: "max-w-64 text-sm", cell: ({ s }) => (s.brands?.length ? s.brands.join(", ") : <span className="text-faint">—</span>) },
    { key: "contact", label: "Contact", optional: true, cellClassName: "text-sm", cell: ({ s }) => <>{s.contactName ?? "—"}{s.phone && <span className="block text-xs text-muted">{s.phone}</span>}</> },
    { key: "rating", label: "Rating", sort: true, optional: true, cell: ({ s }) => <Stars value={s.rating} /> },
    { key: "offers", label: "Offers", sort: true, align: "right", optional: true, cell: (r) => r.offerCount },
    { key: "awarded", label: "Awarded", sort: true, align: "right", optional: true, cell: (r) => r.awardedCount },
    { key: "ordered", label: "Ordered (EGP)", sort: true, align: "right", optional: true, className: "whitespace-nowrap",
      cell: ({ s }) => { const o = ordered.get(s.id); return o ? (o.total == null ? `${formatMoney(o.partial, "EGP", { compact: true })}*` : formatMoney(o.total, "EGP", { compact: true })) : "—"; } },
  ];
}

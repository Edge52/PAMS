import Link from "next/link";
import { AutoSubmit } from "@/components/auto-submit";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { offers, poLines, purchaseOrders, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { CURRENCIES, formatMoney } from "@/lib/format";
import { options, SUPPLIER_TYPES, type SupplierType } from "@/lib/procurement/labels";
import { Stars } from "@/components/procurement/stars";
import { SavedFilters } from "@/components/saved-filters";
import { ListPager } from "@/components/list-pager";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { rateToEgp } from "@/lib/server-utils";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; show?: string; sort?: string; dir?: string; page?: string }> }) {
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
  // Wave 41: counted, sorted and paged in the database. "Ordered" is every order not cancelled, in EGP at the latest
  // saved rates, worked out in one query (it used to read every PO and convert per supplier).
  const egpRate = new Map(await Promise.all(CURRENCIES.map(async (c) => [c as string, await rateToEgp(c)] as const)));
  const rated = [...egpRate].filter(([, r]) => r != null);
  const rateCase = sql.join([sql`case ${purchaseOrders.currency}`, ...rated.map(([c, r]) => sql`when ${c} then ${r}::numeric`), sql`else null end`], sql` `);
  const ordered = sql<string | null>`(select sum((select coalesce(sum(${poLines.quantity} * ${poLines.unitPrice}), 0) from ${poLines} where ${poLines.poId} = ${purchaseOrders.id}) * coalesce(${rateCase}, 0))
    from ${purchaseOrders} where ${purchaseOrders.supplierId} = ${suppliers.id} and ${purchaseOrders.status} <> 'CANCELLED')`;
  const unrated = sql<boolean>`exists (select 1 from ${purchaseOrders} where ${purchaseOrders.supplierId} = ${suppliers.id} and ${purchaseOrders.status} <> 'CANCELLED' and (${rateCase}) is null)`;
  const whereSql = where.length ? and(...where) : undefined;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(suppliers).where(whereSql);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const rows = await db.select({ s: suppliers, offerCount, awardedCount, ordered, unrated })
    .from(suppliers).where(whereSql)
    .orderBy(...sqlOrder(sort, { name: suppliers.name, type: suppliers.type, rating: suppliers.rating, offers: offerCount, awarded: awardedCount, ordered }, [asc(suppliers.name)], [asc(suppliers.id)]))
    .limit(paging.size).offset(paging.offset);
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
      <SavedFilters page="suppliers" />
      {n === 0 ? (
        filtered ? <EmptyState title="No suppliers match" action={<LinkButton href="/procurement/suppliers">Show all suppliers</LinkButton>}>Try another name or brand.</EmptyState>
          : <EmptyState title="No suppliers yet" action={can(me.role, "suppliers.edit") ? <LinkButton href="/procurement/suppliers/new" variant="primary">Add the first supplier</LinkButton> : undefined}>
            Add the local agents and distributors you invite to tenders, with the brands they represent.</EmptyState>
      ) : (
        <DataTable id="suppliers" label="Suppliers" path="/procurement/suppliers" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.s.id}
          rowClassName={(r) => (r.s.active ? undefined : "text-muted")} columns={supplierColumns()}
          footer={<ListPager paging={paging} path="/procurement/suppliers" sp={sp} what="suppliers" />} />
      )}
    </>
  );
}

const SORT_KEYS = ["name", "type", "rating", "offers", "awarded", "ordered"] as const;
type SupplierRow = { s: typeof suppliers.$inferSelect; offerCount: number; awardedCount: number; ordered: string | null; unrated: boolean };

function supplierColumns(): Column<SupplierRow>[] {
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
      cell: (r) => (r.ordered == null ? "—" : <span title={r.unrated ? "Some orders are in a currency with no saved rate" : undefined}>{formatMoney(Number(r.ordered), "EGP", { compact: true })}{r.unrated ? "*" : ""}</span>) },
  ];
}

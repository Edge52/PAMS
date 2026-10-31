import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, isNotNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { offerLines, offers, projects, suppliers } from "@/db/schema";
import { EmptyState, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { OffersTable } from "@/components/procurement/offers-table";
import { addDaysISO, todayISO } from "@/lib/format";
import { OFFER_STATUSES, options, type OfferStatus } from "@/lib/procurement/labels";
import { offerTotals } from "@/lib/procurement/server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Offers" };

export default async function OffersPage({ searchParams }: { searchParams: Promise<{ status?: string; supplierId?: string; expiring?: string; projectId?: string; q?: string }> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const where: SQL[] = [];
  const scope = scopeWhere(projects.facilityId, await facilityScope(me));
  if (scope) where.push(scope);
  if (sp.status && (OFFER_STATUSES as readonly string[]).includes(sp.status)) where.push(eq(offers.status, sp.status as OfferStatus));
  const supplierId = Number(sp.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) where.push(eq(offers.supplierId, supplierId));
  const projectId = Number(sp.projectId);
  if (Number.isInteger(projectId) && projectId > 0) where.push(eq(offers.projectId, projectId));
  const expiring = sp.expiring === "1";
  if (expiring) {
    where.push(isNotNull(offers.validUntil), gte(offers.validUntil, todayISO()), lte(offers.validUntil, addDaysISO(todayISO(), 14)),
      notInArray(offers.status, ["AWARDED", "REJECTED", "WITHDRAWN"]));
  }
  const q = sp.q?.trim();
  if (q) where.push(or(ilike(offers.reference, `%${q}%`), ilike(suppliers.name, `%${q}%`), ilike(projects.code, `%${q}%`))!);

  const [rows, supplierList, projectList] = await Promise.all([
    db.select({
      id: offers.id, reference: offers.reference, status: offers.status, currency: offers.currency, offerDate: offers.offerDate,
      validUntil: offers.validUntil, supplierId: offers.supplierId, supplier: suppliers.name, projectId: offers.projectId, projectCode: projects.code,
      technicalScore: offers.technicalScore, financialScore: offers.financialScore,
      lines: sql<number>`(select count(*)::int from ${offerLines} where ${offerLines.offerId} = ${offers.id})`,
    }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(where.length ? and(...where) : undefined).orderBy(desc(offers.offerDate), desc(offers.id)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    db.select({ id: projects.id, code: projects.code }).from(projects).where(scope).orderBy(desc(projects.id)),
  ]);
  const totals = await offerTotals(rows.map((r) => r.id));
  const filtered = Boolean(sp.status || sp.supplierId || expiring || sp.projectId || q);

  return (
    <>
      <PageHeader title="Offers" description="Every quotation received, across all projects."
        actions={can(me.role, "offers.edit") ? <LinkButton href="/procurement/offers/new" variant="primary">Register offer</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search reference, supplier or project" /></label>
        <label><span className="sr-only">Status</span>
          <Select name="status" defaultValue={sp.status ?? ""} placeholder="All statuses" options={options(OFFER_STATUSES)} className="w-auto" /></label>
        <label><span className="sr-only">Supplier</span>
          <Select name="supplierId" defaultValue={sp.supplierId ?? ""} placeholder="All suppliers" options={supplierList.map((s) => ({ value: s.id, label: s.name }))} className="w-auto max-w-56" /></label>
        <label><span className="sr-only">Project</span>
          <Select name="projectId" defaultValue={sp.projectId ?? ""} placeholder="All projects" options={projectList.map((p) => ({ value: p.id, label: p.code }))} className="w-auto max-w-56" /></label>
        <label className="flex items-center gap-2 px-1 py-1.5 text-sm">
          <input type="checkbox" name="expiring" value="1" defaultChecked={expiring} className="size-4 accent-[var(--color-primary)]" />Expiring in 14 days</label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/offers" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No offers match these filters" action={<LinkButton href="/procurement/offers">Show all offers</LinkButton>}>
            {expiring ? "Good news: nothing open expires in the next 14 days." : "Try a different status, supplier or search."}
          </EmptyState>
        ) : (
          <EmptyState title="No offers yet" action={can(me.role, "offers.edit") ? <LinkButton href="/procurement/offers/new" variant="primary">Register the first offer</LinkButton> : undefined}>
            Register each quotation you receive with its lines and prices, then record compliance against the specification.
          </EmptyState>
        )
      ) : (
        <OffersTable rows={rows.map((r) => ({ ...r, total: totals.get(r.id) ?? 0 }))} />
      )}
    </>
  );
}

import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, projects, rfqs, rfqSuppliers } from "@/db/schema";
import { AutoSubmit } from "@/components/auto-submit";
import { SavedFilters } from "@/components/saved-filters";
import { EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft } from "@/components/procurement/bits";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { options, RFQ_STATUSES, type RfqStatus } from "@/lib/procurement/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests for quotation" };

const LIMIT = 500;

export default async function RfqsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const me = await requirePermission("procurement.view");
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) || undefined;
  const status = (RFQ_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as RfqStatus) : undefined;
  const filtered = !!(q || status);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const mayEdit = can(me.role, "procurement.edit");
  const rows = await db.select({
    id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, issueDate: rfqs.issueDate, closingDate: rfqs.closingDate,
    projectId: rfqs.projectId, project: projects.code,
    invited: sql<number>`(select count(*)::int from ${rfqSuppliers} where ${rfqSuppliers.rfqId} = ${rfqs.id})`,
    offers: sql<number>`(select count(*)::int from ${offers} where ${offers.rfqId} = ${rfqs.id})`,
  }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId))
    .where(and(scopeWhere(projects.facilityId, await facilityScope(me)), status ? eq(rfqs.status, status) : undefined,
      like ? or(ilike(rfqs.number, like), ilike(rfqs.title, like), ilike(projects.code, like)) : undefined))
    .orderBy(desc(rfqs.id)).limit(LIMIT);
  return (
    <>
      <PageHeader title="Requests for quotation" back={{ href: "/procurement", label: "Projects & tenders" }}
        actions={mayEdit ? <LinkButton href="/procurement/rfqs/new" variant="primary">New RFQ</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <AutoSubmit />
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">Search</span>
          <Input type="search" name="q" defaultValue={q ?? ""} placeholder="Search number, title or project" /></label>
        <label><span className="sr-only">Status</span>
          <Select name="status" defaultValue={status ?? ""} placeholder="All statuses" options={options(RFQ_STATUSES)} className="w-auto" /></label>
        <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Apply filters</button>
        {filtered && <Link href="/procurement/rfqs" className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      <SavedFilters page="rfqs" />
      {rows.length === 0 && filtered ? (
        <EmptyState title="No RFQs match these filters" action={<LinkButton href="/procurement/rfqs">Show all RFQs</LinkButton>}>Try a different status or search.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No RFQs yet" action={mayEdit ? <LinkButton href="/procurement/rfqs/new" variant="primary">Create an RFQ</LinkButton> : undefined}>
          RFQs are created from a project, with items from its BOQ or specifications.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Number</Th><Th>Title</Th><Th>Project</Th><Th>Status</Th><Th>Issued</Th><Th>Closing</Th><Th align="right">Invited</Th><Th align="right">Offers</Th></tr></THead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap"><Link href={`/procurement/rfqs/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link></Td>
                <Td>{r.title}</Td>
                <Td><Link href={`/procurement/${r.projectId}?tab=rfqs`} className="hover:text-primary">{r.project}</Link></Td>
                <Td><StatusBadge value={r.status} /></Td>
                <Td className="whitespace-nowrap">{formatDate(r.issueDate)}</Td>
                <Td className="whitespace-nowrap"><DaysLeft date={r.closingDate} closedLabel={r.status === "ISSUED" || r.status === "DRAFT" ? undefined : "closed"} /></Td>
                <Td align="right">{r.invited}</Td>
                <Td align="right">{r.offers}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

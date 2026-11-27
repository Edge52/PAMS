import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, projects, rfqs, rfqSuppliers } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { DaysLeft } from "@/components/procurement/bits";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests for quotation" };

const SORT_KEYS = ["number", "title", "project", "status", "issued", "closing", "invited", "offers"] as const;
const invited = sql<number>`(select count(*)::int from ${rfqSuppliers} where ${rfqSuppliers.rfqId} = ${rfqs.id})`;
const offerCount = sql<number>`(select count(*)::int from ${offers} where ${offers.rfqId} = ${rfqs.id})`;

export default async function RfqsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const mayEdit = can(me.role, "procurement.edit");
  const sp = await searchParams;
  const sort = tableSort(sp, SORT_KEYS);
  const where = scopeWhere(projects.facilityId, await facilityScope(me));
  // Wave 41: counted and paged in the database.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId)).where(where);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const rows = await db.select({
    id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, issueDate: rfqs.issueDate, closingDate: rfqs.closingDate,
    projectId: rfqs.projectId, project: projects.code, invited, offers: offerCount,
  }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId)).where(where)
    .orderBy(...sqlOrder(sort, { number: rfqs.number, title: rfqs.title, project: projects.code, status: rfqs.status, issued: rfqs.issueDate, closing: rfqs.closingDate, invited, offers: offerCount },
      [desc(rfqs.id)], [desc(rfqs.id)]))
    .limit(paging.size).offset(paging.offset);
  return (
    <>
      <PageHeader title="Requests for quotation" back={{ href: "/procurement", label: "Projects & tenders" }}
        actions={mayEdit ? <LinkButton href="/procurement/rfqs/new" variant="primary">New RFQ</LinkButton> : undefined} />
      <DataTable id="rfqs" label="Requests for quotation" path="/procurement/rfqs" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.id} columns={COLUMNS}
        footer={<ListPager paging={paging} path="/procurement/rfqs" sp={sp} what="RFQs" />}
        empty={<EmptyState title="No RFQs yet" action={mayEdit ? <LinkButton href="/procurement/rfqs/new" variant="primary">Create an RFQ</LinkButton> : undefined}>
          RFQs are created from a project, with items from its BOQ or specifications.
        </EmptyState>} />
    </>
  );
}

type Row = { id: number; number: string; title: string; status: string; issueDate: string | null; closingDate: string | null; projectId: number; project: string; invited: number; offers: number };

const COLUMNS: Column<Row>[] = [
  { key: "number", label: "Number", sort: true, className: "whitespace-nowrap", cell: (r) => <Link href={`/procurement/rfqs/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link> },
  { key: "title", label: "Title", sort: true, cell: (r) => r.title },
  { key: "project", label: "Project", sort: true, optional: true, cell: (r) => <Link href={`/procurement/${r.projectId}?tab=rfqs`} className="hover:text-primary">{r.project}</Link> },
  { key: "status", label: "Status", sort: true, cell: (r) => <StatusBadge value={r.status} /> },
  { key: "issued", label: "Issued", sort: true, optional: true, className: "whitespace-nowrap", cell: (r) => formatDate(r.issueDate) },
  { key: "closing", label: "Closing", sort: true, className: "whitespace-nowrap", cell: (r) => <DaysLeft date={r.closingDate} closedLabel={r.status === "ISSUED" || r.status === "DRAFT" ? undefined : "closed"} /> },
  { key: "invited", label: "Invited", sort: true, align: "right", optional: true, cell: (r) => r.invited },
  { key: "offers", label: "Offers", sort: true, align: "right", optional: true, cell: (r) => r.offers },
];

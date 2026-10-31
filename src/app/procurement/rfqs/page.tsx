import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, projects, rfqs, rfqSuppliers } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft } from "@/components/procurement/bits";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Requests for quotation" };

export default async function RfqsPage() {
  const me = await requirePermission("procurement.view");
  const mayEdit = can(me.role, "procurement.edit");
  const rows = await db.select({
    id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, issueDate: rfqs.issueDate, closingDate: rfqs.closingDate,
    projectId: rfqs.projectId, project: projects.code,
    invited: sql<number>`(select count(*)::int from ${rfqSuppliers} where ${rfqSuppliers.rfqId} = ${rfqs.id})`,
    offers: sql<number>`(select count(*)::int from ${offers} where ${offers.rfqId} = ${rfqs.id})`,
  }).from(rfqs).innerJoin(projects, eq(projects.id, rfqs.projectId))
    .where(scopeWhere(projects.facilityId, await facilityScope(me))).orderBy(desc(rfqs.id));
  return (
    <>
      <PageHeader title="Requests for quotation" back={{ href: "/procurement", label: "Projects & tenders" }}
        actions={mayEdit ? <LinkButton href="/procurement/rfqs/new" variant="primary">New RFQ</LinkButton> : undefined} />
      {rows.length === 0 ? (
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

import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqs, offers, projects, rfqs, rfqSuppliers } from "@/db/schema";
import { EmptyState, LinkButton, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { DaysLeft } from "@/components/procurement/bits";
import { formatDate } from "@/lib/format";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;

export async function RfqsTab({ project, me }: { project: Project; me: CurrentUser }) {
  const mayEdit = can(me.role, "procurement.edit");
  const rows = await db.select({
    id: rfqs.id, number: rfqs.number, title: rfqs.title, status: rfqs.status, issueDate: rfqs.issueDate, closingDate: rfqs.closingDate,
    boqId: rfqs.boqId, boqName: boqs.name,
    invited: sql<number>`(select count(*)::int from ${rfqSuppliers} where ${rfqSuppliers.rfqId} = ${rfqs.id})`,
    offers: sql<number>`(select count(*)::int from ${offers} where ${offers.rfqId} = ${rfqs.id})`,
  }).from(rfqs).leftJoin(boqs, eq(boqs.id, rfqs.boqId)).where(eq(rfqs.projectId, project.id)).orderBy(desc(rfqs.id));

  return (
    <div className="space-y-4">
      {mayEdit && <div className="flex justify-end"><LinkButton href={`/procurement/rfqs/new?projectId=${project.id}`} variant="primary">New RFQ</LinkButton></div>}
      {rows.length === 0 ? (
        <EmptyState title="No requests for quotation yet" action={mayEdit ? <LinkButton href={`/procurement/rfqs/new?projectId=${project.id}`} variant="primary">Create an RFQ</LinkButton> : undefined}>
          An RFQ lists the items (from a BOQ or from the specifications) and the suppliers you invite to quote.
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><Th>Number</Th><Th>Title</Th><Th>Status</Th><Th>Source</Th><Th>Issued</Th><Th>Closing</Th><Th align="right">Invited</Th><Th align="right">Offers</Th></tr></THead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap"><Link href={`/procurement/rfqs/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link></Td>
                <Td>{r.title}</Td>
                <Td><StatusBadge value={r.status} /></Td>
                <Td>{r.boqId ? <Link href={`/boq/${r.boqId}`} className="text-primary hover:underline">{r.boqName ?? "BOQ"}</Link> : <span className="text-muted">Specifications</span>}</Td>
                <Td className="whitespace-nowrap">{formatDate(r.issueDate)}</Td>
                <Td className="whitespace-nowrap"><DaysLeft date={r.closingDate} closedLabel={r.status === "ISSUED" || r.status === "DRAFT" ? undefined : "closed"} /></Td>
                <Td align="right">{r.invited}</Td>
                <Td align="right">{r.offers}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

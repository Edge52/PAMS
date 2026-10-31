import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offerLines, offers, projects, suppliers } from "@/db/schema";
import { EmptyState, LinkButton } from "@/components/ui";
import { OffersTable } from "@/components/procurement/offers-table";
import { offerTotals } from "@/lib/procurement/server";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;

export async function OffersTab({ project, me }: { project: Project; me: CurrentUser }) {
  const mayEdit = can(me.role, "offers.edit");
  const rows = await db.select({
    id: offers.id, reference: offers.reference, status: offers.status, currency: offers.currency, offerDate: offers.offerDate,
    validUntil: offers.validUntil, supplierId: offers.supplierId, supplier: suppliers.name, projectId: offers.projectId, projectCode: projects.code,
    technicalScore: offers.technicalScore, financialScore: offers.financialScore,
    lines: sql<number>`(select count(*)::int from ${offerLines} where ${offerLines.offerId} = ${offers.id})`,
  }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).innerJoin(projects, eq(projects.id, offers.projectId))
    .where(eq(offers.projectId, project.id)).orderBy(desc(offers.id));
  const totals = await offerTotals(rows.map((r) => r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {rows.length > 1 && <LinkButton href={`/procurement/${project.id}?tab=comparison`}>Compare offers</LinkButton>}
        {mayEdit && <LinkButton href={`/procurement/offers/new?projectId=${project.id}`} variant="primary">Register offer</LinkButton>}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No offers registered" action={mayEdit ? <LinkButton href={`/procurement/offers/new?projectId=${project.id}`} variant="primary">Register offer</LinkButton> : undefined}>
          Register each quotation as it arrives. You can attach the PDF and datasheets on the offer page.
        </EmptyState>
      ) : (
        <OffersTable showProject={false} rows={rows.map((r) => ({ ...r, total: totals.get(r.id) ?? 0 }))} />
      )}
    </div>
  );
}

import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { facilities, offers, projects, purchaseOrders, rfqs, techSpecs } from "@/db/schema";
import { LinkButton, PageHeader, StatusBadge, TabLinks } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { OverviewTab } from "./_tabs/overview";
import { SpecsTab } from "./_tabs/specs";
import { RfqsTab } from "./_tabs/rfqs";
import { OffersTab } from "./_tabs/offers";
import { ComparisonTab } from "./_tabs/comparison";
import { PurchaseOrdersTab } from "./_tabs/purchase-orders";
import { CommitteesTab } from "./_tabs/committees";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "specs", label: "Specifications" },
  { key: "rfqs", label: "RFQs" },
  { key: "offers", label: "Offers" },
  { key: "comparison", label: "Comparison" },
  { key: "committees", label: "Committees" },
  { key: "pos", label: "Purchase orders" },
  { key: "documents", label: "Documents" },
] as const;

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }) {
  const id = Number((await params).projectId);
  if (!Number.isInteger(id)) return { title: "Project" };
  const [p] = await db.select({ code: projects.code }).from(projects).where(eq(projects.id, id));
  return { title: p?.code ?? "Project" };
}

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; tw?: string }>;
}) {
  const me = await requirePermission("procurement.view");
  const { projectId } = await params;
  const sp = await searchParams;
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ project: projects, facility: facilities }).from(projects)
    .leftJoin(facilities, eq(facilities.id, projects.facilityId)).where(eq(projects.id, id));
  if (!row) notFound();
  const { project, facility } = row;
  await requireFacilityAccess(project.facilityId, me);
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";

  const [[counts]] = await Promise.all([
    db.select({
      specs: sql<number>`(select count(*)::int from ${techSpecs} where ${techSpecs.projectId} = ${id})`,
      rfqs: sql<number>`(select count(*)::int from ${rfqs} where ${rfqs.projectId} = ${id})`,
      offers: sql<number>`(select count(*)::int from ${offers} where ${offers.projectId} = ${id})`,
      pos: sql<number>`(select count(*)::int from ${purchaseOrders} where ${purchaseOrders.projectId} = ${id} and ${purchaseOrders.status} <> 'CANCELLED')`,
    }).from(projects).where(eq(projects.id, id)),
  ]);
  // Purchase orders can only be raised from an award the competent authority approved.
  const awarded = await db.select({ id: offers.id }).from(offers)
    .where(and(eq(offers.projectId, id), eq(offers.status, "AWARDED"), sql`${offers.awardApprovedOn} is not null`));

  const label = (k: string, n?: number) => `${TABS.find((t) => t.key === k)!.label}${n ? ` (${n})` : ""}`;
  const tabs = TABS.map((t) => ({
    key: t.key,
    href: `/procurement/${id}${t.key === "overview" ? "" : `?tab=${t.key}`}`,
    label: t.key === "specs" ? label(t.key, counts.specs) : t.key === "rfqs" ? label(t.key, counts.rfqs)
      : t.key === "offers" ? label(t.key, counts.offers) : t.key === "pos" ? label(t.key, counts.pos) : t.label,
  }));

  return (
    <>
      <PageHeader
        back={{ href: "/procurement", label: "Projects & tenders" }}
        title={<span className="flex flex-wrap items-center gap-2">{project.title} <StatusBadge value={project.status} /></span>}
        description={<>{project.code}{project.client ? ` · ${project.client}` : ""}{facility ? ` · ${facility.name}` : ""}</>}
        actions={<>
          {can(me.role, "offers.edit") && <LinkButton href={`/procurement/offers/new?projectId=${id}`}>Register offer</LinkButton>}
          {awarded.length > 0 && can(me.role, "po.create")
            ? <LinkButton href={`/procurement/purchase-orders/new?offerId=${awarded[0].id}`} variant="primary">Create purchase order</LinkButton>
            : <LinkButton href={`/procurement/${id}?tab=comparison`} variant="primary">Compare offers</LinkButton>}
        </>}
      />
      <TabLinks tabs={tabs} active={tab} />
      {tab === "overview" && <OverviewTab project={project} facility={facility} counts={counts} me={me} />}
      {tab === "specs" && <SpecsTab project={project} me={me} />}
      {tab === "rfqs" && <RfqsTab project={project} me={me} />}
      {tab === "offers" && <OffersTab project={project} me={me} />}
      {tab === "comparison" && <ComparisonTab project={project} tw={sp.tw} me={me} />}
      {tab === "committees" && <CommitteesTab project={project} me={me} />}
      {tab === "pos" && <PurchaseOrdersTab project={project} me={me} />}
      {tab === "documents" && (
        <DocumentsPanel entityType="project" entityId={id} returnPath={`/procurement/${id}?tab=documents`}
          title="Tender documents (booklet, clarifications, minutes)" />
      )}
    </>
  );
}

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, rfqs } from "@/db/schema";
import { EmptyState, Field, LinkButton, PageHeader, Panel, Select } from "@/components/ui";
import { OfferForm } from "@/components/procurement/offer-form";
import { todayISO, addDaysISO } from "@/lib/format";
import { offerFormData } from "@/lib/procurement/server";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";
import { createOffer } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Register offer" };

export default async function NewOfferPage({ searchParams }: { searchParams: Promise<{ projectId?: string; rfqId?: string; supplierId?: string }> }) {
  await requirePermission("procurement.view");
  const me = await requirePermission("offers.edit");
  const sp = await searchParams;
  const projectId = Number(sp.projectId);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    const list = await db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
      .where(scopeWhere(projects.facilityId, await facilityScope(me))).orderBy(desc(projects.id));
    return (
      <>
        <PageHeader title="Register offer" back={{ href: "/procurement/offers", label: "Offers" }} description="Offers belong to a project. Which tender is this quotation for?" />
        {list.length === 0 ? (
          <EmptyState title="Create a project first" action={<LinkButton href="/procurement/new" variant="primary">New project</LinkButton>}>
            Offers are registered against a project or tender so they can be compared.
          </EmptyState>
        ) : (
          <Panel>
            <form className="flex flex-wrap items-end gap-3">
              <Field label="Project" className="min-w-72 flex-1">
                <Select name="projectId" required placeholder="Choose a project" options={list.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} />
              </Field>
              <button className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">Continue</button>
            </form>
          </Panel>
        )}
      </>
    );
  }

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return (
      <>
        <PageHeader title="Register offer" back={{ href: "/procurement/offers", label: "Offers" }} />
        <EmptyState title="That project was not found" action={<LinkButton href="/procurement/offers/new">Choose a project</LinkButton>}>It may have been deleted.</EmptyState>
      </>
    );
  }
  await requireFacilityAccess(project.facilityId, me);
  const projectRfqs = await db.select({ id: rfqs.id, number: rfqs.number, title: rfqs.title }).from(rfqs).where(eq(rfqs.projectId, projectId)).orderBy(desc(rfqs.id));
  const requestedRfq = sp.rfqId ? Number(sp.rfqId) : null;
  const rfqId = requestedRfq && projectRfqs.some((r) => r.id === requestedRfq) ? requestedRfq : null;
  const data = await offerFormData(projectId, rfqId);
  const supplierId = sp.supplierId ? Number(sp.supplierId) : null;

  const prefill = data.rfqLines.length
    ? data.rfqLines.map((l) => ({
      deviceTypeId: l.deviceTypeId, boqLineId: data.boqLines.find((b) => b.deviceTypeId === l.deviceTypeId)?.id ?? null,
      description: l.name, manufacturer: "", model: "", countryOfOrigin: "", quantity: l.quantity ?? 1, unitPrice: 0, discountPct: 0, isOptional: false,
    }))
    : [...data.specs.values()].map((s) => {
      const dt = data.deviceTypes.find((d) => d.id === s.deviceTypeId);
      return { deviceTypeId: s.deviceTypeId, boqLineId: null, description: dt?.name ?? "", manufacturer: "", model: "", countryOfOrigin: "", quantity: 1, unitPrice: 0, discountPct: 0, isOptional: false };
    });

  return (
    <>
      <PageHeader title="Register offer" back={{ href: `/procurement/${projectId}?tab=offers`, label: project.code }}
        description={<>Quotation received for <Link href={`/procurement/${projectId}`} className="text-primary hover:underline">{project.title}</Link>. After saving, record compliance against the specification line by line.</>} />

      {projectRfqs.length > 0 && (
        <Panel className="mb-5">
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="projectId" value={projectId} />
            {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}
            <Field label="In response to RFQ" className="min-w-72 flex-1" hint="Choosing the RFQ pre-fills the lines and quantities">
              <Select name="rfqId" defaultValue={rfqId ?? ""} placeholder="Not linked to an RFQ" options={projectRfqs.map((r) => ({ value: r.id, label: `${r.number} — ${r.title}` }))} />
            </Field>
            <button className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Use this RFQ</button>
          </form>
        </Panel>
      )}

      {data.suppliers.length === 0 ? (
        <EmptyState title="Add the supplier first" action={<LinkButton href="/procurement/suppliers/new" variant="primary">Add supplier</LinkButton>}>
          Offers are registered against a supplier from your supplier list.
        </EmptyState>
      ) : (
        <OfferForm
          action={createOffer}
          projectId={projectId}
          rfqId={rfqId}
          header={{ supplierId, offerDate: todayISO(), validUntil: addDaysISO(todayISO(), 90), currency: project.currency }}
          lines={prefill}
          suppliers={data.suppliers}
          deviceTypes={data.deviceTypes}
          boqLines={data.boqLines}
          submitLabel="Register offer"
        />
      )}
    </>
  );
}

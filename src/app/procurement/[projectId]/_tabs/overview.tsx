import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities as facilitiesT, offers, projects } from "@/db/schema";
import { Details, LinkButton, Panel, Select, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { ActivityPanel, DaysLeft, TextLink } from "@/components/procurement/bits";
import { ProjectForm } from "@/components/procurement/project-form";
import { formatMoney, num } from "@/lib/format";
import { options, PROJECT_STATUSES } from "@/lib/procurement/labels";
import { offerTotals, projectPoValues, sumInCurrency } from "@/lib/procurement/server";
import { setProjectStatus, updateProject } from "../../actions";
import { facilityScope, type CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";


type Project = typeof projects.$inferSelect;
type Facility = typeof facilitiesT.$inferSelect;

export async function OverviewTab({ project, facility, counts, me }: {
  project: Project; facility: Facility | null; counts: { specs: number; rfqs: number; offers: number; pos: number }; me: CurrentUser;
}) {
  const mayEdit = can(me.role, "procurement.edit");
  const awardedRows = await db.select({ id: offers.id, currency: offers.currency, status: offers.status }).from(offers).where(eq(offers.projectId, project.id));
  const awarded = awardedRows.filter((o) => o.status === "AWARDED");
  const totals = await offerTotals(awarded.map((o) => o.id));
  const awardedSum = await sumInCurrency(awarded.map((o) => ({ amount: totals.get(o.id) ?? 0, currency: o.currency })), project.currency);
  const po = (await projectPoValues([project])).get(project.id);
  const budget = project.budget != null ? num(project.budget) : null;
  const variance = budget != null && awardedSum.total != null && awarded.length ? budget - awardedSum.total : null;
  const scope = await facilityScope(me);
  const facs = await db.select({ id: facilitiesT.id, code: facilitiesT.code, name: facilitiesT.name }).from(facilitiesT)
    .where(scope ? inArray(facilitiesT.id, scope.length ? scope : [-1]) : undefined).orderBy(asc(facilitiesT.name));

  const next = nextStep(project, counts, awarded.length);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budget" value={budget != null ? formatMoney(budget, project.currency, { compact: true }) : "—"} hint={project.currency} />
        <Stat label="Awarded value"
          value={awarded.length === 0 ? "—" : awardedSum.total == null ? "Rate missing" : formatMoney(awardedSum.total, project.currency, { compact: true })}
          hint={awarded.length ? `${awarded.length} awarded offer${awarded.length === 1 ? "" : "s"}` : "Nothing awarded yet"}
          href={`/procurement/${project.id}?tab=comparison`} />
        <Stat label={variance != null && variance < 0 ? "Over budget by" : "Remaining budget"}
          value={variance == null ? "—" : formatMoney(Math.abs(variance), project.currency, { compact: true })}
          hint={variance != null && budget ? `${Math.round(((budget - variance) / budget) * 100)}% of budget awarded` : undefined} />
        <Stat label="Ordered (purchase orders)"
          value={!po || po.count === 0 ? "—" : po.total == null ? "Rate missing" : formatMoney(po.total, project.currency, { compact: true })}
          hint={po?.count ? `${po.count} purchase order${po.count === 1 ? "" : "s"}` : undefined} href={`/procurement/${project.id}?tab=pos`} />
      </div>

      {next && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-primary bg-primary-soft px-4 py-3 text-sm">
          <span><span className="font-semibold text-primary-strong">Next step: </span>{next.text}</span>
          <LinkButton href={next.href} variant="primary">{next.action}</LinkButton>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel title="Details">
            <Details items={[
              { label: "Tender / project code", value: project.code },
              { label: "Client", value: project.client },
              { label: "Facility", value: facility ? <TextLink href={`/facilities/${facility.id}`}>{facility.name}</TextLink> : null },
              { label: "Evaluation currency", value: project.currency },
              { label: "Submission deadline", value: project.submissionDeadline ? <DaysLeft date={project.submissionDeadline} /> : null },
              { label: "Budget", value: budget != null ? formatMoney(budget, project.currency) : null },
            ]} />
            {project.notes && <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-sm">{project.notes}</p>}
          </Panel>

          {mayEdit && <Panel title="Edit project">
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-primary">Change code, title, client, budget or deadline</summary>
              <div className="mt-4"><ProjectForm action={updateProject.bind(null, project.id)} project={project} facilities={facs} submitLabel="Save changes" /></div>
            </details>
          </Panel>}
        </div>

        <div className="space-y-5">
          {mayEdit && <Panel title="Status">
            <ActionForm action={setProjectStatus} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-sm font-semibold">Project status</span>
                <Select name="status" defaultValue={project.status} options={options(PROJECT_STATUSES)} />
              </label>
              <SubmitButton variant="secondary">Change status</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-muted">The status moves forward on its own when you issue an RFQ, award an offer or receive goods.</p>
          </Panel>}
          <ActivityPanel entityType="project" entityId={project.id} />
        </div>
      </div>
    </div>
  );
}

function nextStep(p: Project, c: { specs: number; rfqs: number; offers: number; pos: number }, awarded: number) {
  const base = `/procurement/${p.id}`;
  if (p.status === "CLOSED" || p.status === "CANCELLED") return null;
  if (c.specs === 0) return { text: "write the technical specification for each device type.", action: "Add specification", href: `${base}?tab=specs` };
  if (c.rfqs === 0 && c.offers === 0) return { text: "send a request for quotation to suppliers.", action: "New RFQ", href: `/procurement/rfqs/new?projectId=${p.id}` };
  if (c.offers === 0) return { text: "register the offers you receive.", action: "Register offer", href: `/procurement/offers/new?projectId=${p.id}` };
  if (awarded === 0) return { text: "fill in compliance on each offer, compare them and recommend the award (the committee signs, then the competent authority approves).", action: "Open comparison", href: `${base}?tab=comparison` };
  if (c.pos === 0) return { text: "turn the awarded offer into a purchase order.", action: "Purchase orders", href: `${base}?tab=pos` };
  return null;
}

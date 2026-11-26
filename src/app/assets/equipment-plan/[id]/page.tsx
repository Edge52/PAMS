import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { equipmentPlanReviews, equipmentPlans, facilities } from "@/db/schema";
import { Badge, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { kpiHelp, kpiText, PLAN_KPIS, PLAN_STATUS_LABELS, PLAN_STATUS_TONE } from "@/lib/compliance/equipment-plan";
import { addDaysISO, formatDate, formatDateTime, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { addPlanReviewAction, newPlanVersionAction, savePlanAction, submitPlanAction, withdrawPlanAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Equipment management plan" };

export default async function EquipmentPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [row] = await db.select({ p: equipmentPlans, facility: facilities.name }).from(equipmentPlans).innerJoin(facilities, eq(facilities.id, equipmentPlans.facilityId)).where(eq(equipmentPlans.id, Number(id)));
  if (!row) notFound();
  await requireFacilityAccess(row.p.facilityId, me);
  const p = row.p;
  const sp = await searchParams;
  const [reviews, activity] = await Promise.all([
    db.select().from(equipmentPlanReviews).where(eq(equipmentPlanReviews.planId, p.id)).orderBy(desc(equipmentPlanReviews.periodTo)).limit(50),
    getActivity("equipment_plan", p.id, 20),
  ]);
  const canEdit = can(me.role, "assets.edit");
  const draft = p.status === "DRAFT";
  const self = `/assets/equipment-plan/${p.id}`;
  const today = todayISO();
  const on = new Map(p.kpis.map((k) => [k.key, k]));

  return (
    <>
      <PageHeader title={`Equipment management plan ${p.year}`} description={`${row.facility} · version ${p.version}`}
        back={{ href: `/assets/equipment-plan?facilityId=${p.facilityId}`, label: "Equipment management plans" }}
        actions={<>
          <LinkButton href={`${self}/print`}>Print plan</LinkButton>
          {canEdit && p.status === "APPROVED" && <ActionForm action={newPlanVersionAction}><input type="hidden" name="planId" value={p.id} /><SubmitButton variant="secondary">Start a new version</SubmitButton></ActionForm>}
        </>} />
      <Notice sp={sp} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={PLAN_STATUS_TONE[p.status]}>{PLAN_STATUS_LABELS[p.status]}</Badge>
        {p.approvedAt && <span className="text-sm text-muted">Approved {formatDate(p.approvedAt)}</span>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-5">
          {draft && canEdit ? (
            <Panel title="Plan">
              <ActionForm action={savePlanAction} className="space-y-4">
                <input type="hidden" name="planId" value={p.id} />
                <Field label="Scope"><Textarea name="scope" rows={4} defaultValue={p.scope} required /></Field>
                <Field label="Risk method" hint="How devices are ranked for maintenance."><Textarea name="riskMethod" rows={4} defaultValue={p.riskMethod} required /></Field>
                <Field label="Maintenance strategy policy"><Textarea name="maintenanceStrategy" rows={4} defaultValue={p.maintenanceStrategy} required /></Field>
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">KPIs and targets</legend>
                  <output name="kpis" className="sr-only" />
                  <ul className="space-y-2">
                    {PLAN_KPIS.map((k) => (
                      <li key={k.key} className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex min-w-[16rem] items-center gap-2"><input type="checkbox" name={`kpi_${k.key}`} defaultChecked={on.has(k.key)} /> {k.label}</label>
                        <label className="flex items-center gap-1">
                          <span className="text-muted">{k.better === "lower" ? "At most" : "At least"}</span>
                          <Input type="number" step="0.1" min={0} max={k.unit === "%" ? 100 : 100000} name={`target_${k.key}`} defaultValue={on.get(k.key)?.target ?? k.target} className="w-24" aria-label={`${k.label} target`} />
                          <span className="text-muted">{k.unit === "%" ? "%" : ""}</span>
                        </label>
                        <span className="basis-full text-xs text-muted">{k.help}</span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={p.notes ?? ""} /></Field>
                <SubmitButton>Save plan</SubmitButton>
              </ActionForm>
            </Panel>
          ) : (
            <Panel title="Plan">
              <dl className="space-y-4 text-sm">
                <div><dt className="font-semibold">Scope</dt><dd className="whitespace-pre-line">{p.scope}</dd></div>
                <div><dt className="font-semibold">Risk method</dt><dd className="whitespace-pre-line">{p.riskMethod}</dd></div>
                <div><dt className="font-semibold">Maintenance strategy policy</dt><dd className="whitespace-pre-line">{p.maintenanceStrategy}</dd></div>
                {p.notes && <div><dt className="font-semibold">Notes</dt><dd className="whitespace-pre-line">{p.notes}</dd></div>}
              </dl>
              <h3 className="mb-2 mt-5 text-sm font-semibold">KPIs and targets</h3>
              <ul className="space-y-1 text-sm">{p.kpis.map((k) => <li key={k.key}>{k.label}: <b>{kpiText(k.target, k.unit)}</b> <span className="text-xs text-muted">{kpiHelp(k.key)}</span></li>)}</ul>
            </Panel>
          )}

          <Panel title="Annual evaluations" padded={false}>
            {reviews.length === 0 ? <p className="p-4 text-sm text-muted">No evaluation yet. Record one at least once a year.</p> : (
              <div className="divide-y divide-line">
                {reviews.map((r) => (
                  <section key={r.id} className="px-4 py-3">
                    <h3 className="text-sm font-semibold">{formatDate(r.periodFrom)} to {formatDate(r.periodTo)} <span className="font-normal text-muted">· {r.reviewedByName ?? "—"}, {formatDateTime(r.createdAt)}</span></h3>
                    <Table className="mt-2">
                      <THead><tr><Th>KPI</Th><Th align="right">Target</Th><Th align="right">Found</Th><Th>Met</Th></tr></THead>
                      <tbody>{r.kpiSnapshot.map((k) => (
                        <tr key={k.key}><Td>{k.label}</Td><Td align="right">{kpiText(k.target, k.unit)}</Td><Td align="right">{kpiText(k.value, k.unit)}</Td>
                          <Td>{k.met == null ? <Badge>No figure</Badge> : k.met ? <Badge tone="ok">Met</Badge> : <Badge tone="danger">Not met</Badge>}</Td></tr>
                      ))}</tbody>
                    </Table>
                    {r.findings && <p className="mt-2 whitespace-pre-line text-sm"><b>Findings:</b> {r.findings}</p>}
                    {r.actions && <p className="mt-1 whitespace-pre-line text-sm"><b>Actions:</b> {r.actions}</p>}
                  </section>
                ))}
              </div>
            )}
          </Panel>

          {canEdit && (
            <Panel title="Record an evaluation">
              <ActionForm action={addPlanReviewAction} className="space-y-3">
                <input type="hidden" name="planId" value={p.id} />
                <FormGrid cols={2}>
                  <Field label="From"><Input type="date" name="periodFrom" defaultValue={addDaysISO(today, -365)} required /></Field>
                  <Field label="To"><Input type="date" name="periodTo" defaultValue={today} max={today} required /></Field>
                </FormGrid>
                <Field label="Findings"><Textarea name="findings" rows={3} /></Field>
                <Field label="Actions agreed"><Textarea name="actions" rows={3} /></Field>
                <SubmitButton>Record evaluation</SubmitButton>
                <p className="text-xs text-muted">The KPI figures for the period are worked out now from the records and kept with the evaluation.</p>
              </ActionForm>
            </Panel>
          )}
          <DocumentsPanel entityType="equipment_plan" entityId={p.id} returnPath={self} title="Signed copy and attachments" />
        </div>

        <aside className="space-y-5">
          <ApprovalPanel entity="EQUIPMENT_PLAN" entityId={p.id} returnPath={self} title="Approval" empty="Not submitted for approval yet."
            actions={canEdit && p.status === "SUBMITTED" ? <ActionForm action={withdrawPlanAction}><input type="hidden" name="planId" value={p.id} /><SubmitButton variant="secondary">Withdraw from approval</SubmitButton></ActionForm> : undefined} />
          {canEdit && draft && (
            <Panel title="Submit">
              <p className="mb-3 text-sm text-muted">Save your changes first. The approvers set under Approval rules are told.</p>
              <ActionForm action={submitPlanAction} confirm="Submit this plan for approval? It can't be changed while it waits."><input type="hidden" name="planId" value={p.id} /><SubmitButton>Submit for approval</SubmitButton></ActionForm>
            </Panel>
          )}
          <Panel title="Activity">
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">{activity.map((a) => <li key={a.id}>{a.summary}<span className="block text-xs text-muted">{a.actor ?? "—"} · {formatDateTime(a.at)}</span></li>)}</ul>
            )}
          </Panel>
          <p className="text-xs text-muted">See also the <Link href={`/reports/gahar?facilityId=${p.facilityId}`} className="text-primary hover:underline">GAHAR evidence pack</Link>.</p>
        </aside>
      </div>
    </>
  );
}

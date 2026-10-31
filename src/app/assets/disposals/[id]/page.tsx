import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, disposals, workOrders } from "@/db/schema";
import { Button, Details, Field, FormGrid, Input, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { ApprovalPanel } from "@/components/approvals/approval-panel";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { DISPOSAL_METHODS, METHOD_LABELS, REASON_LABELS } from "@/lib/assets/disposal";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { cancelDisposalAction, completeDisposalAction, resubmitDisposalAction, withdrawDisposalAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Disposal" };

export default async function DisposalPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ d: disposals, tag: assets.assetTag, typeName: deviceTypes.name, model: assets.model, serial: assets.serialNumber,
    assetStatus: assets.status, department: departments.name, purchaseCost: assets.purchaseCost, currency: assets.currency, installDate: assets.installDate })
    .from(disposals).innerJoin(assets, eq(assets.id, disposals.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).where(eq(disposals.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.d.facilityId, me);
  const d = r.d;
  const canDispose = can(me.role, "assets.dispose");
  const [activity, jobs] = await Promise.all([
    getActivity("disposal", d.id, 30),
    db.select({ id: workOrders.id, number: workOrders.number }).from(workOrders).where(and(eq(workOrders.assetId, d.assetId), inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]))),
  ]);
  const p = `/assets/disposals/${d.id}`;
  const hidden = <input type="hidden" name="disposalId" value={d.id} />;

  return (
    <>
      <PageHeader back={{ href: "/assets/disposals", label: "Disposals" }}
        title={<span className="flex flex-wrap items-center gap-2">{d.number} <StatusBadge value={d.status} /></span>}
        description={<>Dispose of <Link href={`/assets/${d.assetId}`} className="font-mono font-semibold text-primary hover:underline">{r.tag}</Link> · {r.typeName}</>} />
      <Notice sp={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Request">
            <Details items={[
              { label: "Reason", value: REASON_LABELS[d.reason] },
              { label: "Method", value: METHOD_LABELS[d.method] },
              { label: "Expected residual value", value: d.estimatedValue ? formatMoney(d.estimatedValue, d.currency ?? "EGP") : null },
              { label: "Requested", value: <>{formatDateTime(d.createdAt)}<div className="text-xs text-muted">{d.requestedByName}</div></> },
              { label: "Device", value: [r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(" · ") || null },
              { label: "Department", value: r.department },
              { label: "Purchase cost", value: r.purchaseCost ? formatMoney(r.purchaseCost, r.currency ?? "USD") : null },
              { label: "Installed", value: formatDate(r.installDate) },
              { label: "Device status now", value: <StatusBadge value={r.assetStatus} /> },
            ]} />
            <p className="mt-4 whitespace-pre-wrap text-sm">{d.justification}</p>
          </Panel>
          {d.status === "COMPLETED" && (
            <Panel title="Disposal record">
              <Details items={[
                { label: "Disposed on", value: formatDate(d.disposedOn) },
                { label: "Method", value: METHOD_LABELS[d.method] },
                { label: "Proceeds", value: d.proceeds ? formatMoney(d.proceeds, d.currency ?? "EGP") : "None" },
                { label: "Record reference", value: d.certificateRef },
              ]} />
              {d.notes && <p className="mt-3 text-sm">{d.notes}</p>}
            </Panel>
          )}
          <ApprovalPanel entity="DISPOSAL" entityId={d.id} returnPath={p} title="Approval" empty="Not submitted for approval yet." />
          <DocumentsPanel entityType="disposal" entityId={d.id} returnPath={p} title="Documents" kinds={["service_report", "photo", "certificate", "other"]}
            emptyHint="Attach the technical assessment, repair quotes, the committee minutes and the scrap or sale certificate below." />
        </div>
        <aside className="space-y-6">
          {canDispose && d.status === "APPROVED" && (
            <Panel title="Record the disposal">
              {jobs.length > 0 ? <p className="text-sm text-warn">First close or cancel the open work orders: {jobs.map((j) => <Link key={j.id} href={`/assets/work-orders/${j.id}`} className="mr-1 text-primary hover:underline">{j.number}</Link>)}</p> : (
                <ActionForm action={completeDisposalAction} className="space-y-3">
                  {hidden}
                  <FormGrid cols={1}>
                    <Field label="Left the hospital on"><Input type="date" name="disposedOn" defaultValue={todayISO()} max={todayISO()} required /></Field>
                    <Field label="Method"><NativeSelect name="method" value={d.method} options={DISPOSAL_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} /></Field>
                    <Field label={`Proceeds (${d.currency ?? "EGP"})`}><Input type="number" name="proceeds" min={0} step="0.01" /></Field>
                    <Field label="Record reference" hint="Committee minutes, scrap certificate or sale receipt number."><Input name="certificateRef" required maxLength={200} /></Field>
                    <Field label="Notes"><Textarea name="notes" rows={2} /></Field>
                  </FormGrid>
                  <Button variant="danger">Record as disposed</Button>
                </ActionForm>
              )}
            </Panel>
          )}
          {canDispose && d.status === "PENDING_APPROVAL" && (
            <Panel title="Withdraw">
              <ActionForm action={withdrawDisposalAction} className="space-y-3">{hidden}<p className="text-sm text-muted">Takes the request back to draft; decisions so far are discarded.</p><Button variant="secondary">Withdraw from approval</Button></ActionForm>
            </Panel>
          )}
          {canDispose && (d.status === "DRAFT" || d.status === "REJECTED") && (
            <Panel title={d.status === "REJECTED" ? "Rejected" : "Draft"}>
              <div className="space-y-3">
                <ActionForm action={resubmitDisposalAction}>{hidden}<Button>Submit for approval</Button></ActionForm>
                <ActionForm action={cancelDisposalAction}>{hidden}<Button variant="ghost">Cancel the request</Button></ActionForm>
              </div>
            </Panel>
          )}
          <Panel title="History">
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="space-y-3">{activity.map((e) => (
                <li key={e.id} className="text-sm"><p>{e.summary}</p><p className="text-xs text-muted">{formatDateTime(e.at)}{e.actor && ` · ${e.actor}`}</p></li>
              ))}</ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}

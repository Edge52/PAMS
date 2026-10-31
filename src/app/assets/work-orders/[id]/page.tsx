import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, departments, deviceTypes, facilities, floors, rooms, users, workOrders } from "@/db/schema";
import { Badge, Button, Details, Field, FormGrid, Input, LinkButton, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { DocumentsPanel } from "@/components/documents-panel";
import { ActionForm } from "@/components/assets/action-form";
import { enumOptions, NativeSelect, Notice } from "@/components/assets/bits";
import { maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { assignableUsers } from "@/lib/assets/work-order-server";
import { allowedActions, downtimeHours, formatHours, isLate, WORK_ORDER_PRIORITIES } from "@/lib/assets/work-orders";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { CURRENCIES, formatDateTime, formatMoney } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import {
  assignWorkOrderAction, cancelWorkOrderAction, completeWorkOrderAction, progressWorkOrderAction, signOffWorkOrderAction,
} from "../actions";

export const dynamic = "force-dynamic";

const assignee = alias(users, "assignee");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("assets.view");
  const { id } = await params;
  return { title: /^\d+$/.test(id) ? `Work order ${id}` : "Work order" };
}

export default async function WorkOrderPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({
    wo: workOrders, tag: assets.assetTag, assetStatus: assets.status, criticality: assets.criticality, manufacturer: assets.manufacturer, model: assets.model,
    serial: assets.serialNumber, typeName: deviceTypes.name, typeCode: deviceTypes.code, roomId: rooms.id, roomCode: rooms.code, roomName: rooms.name,
    floorId: floors.id, floorName: floors.name, departmentName: departments.name, facilityName: facilities.name,
    assigneeName: assignee.name, assigneePhone: assignee.phone,
  }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, workOrders.facilityId)).leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(assignee, eq(assignee.id, workOrders.assignedToId))
    .where(eq(workOrders.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.wo.facilityId, me);
  const wo = r.wo;
  const now = new Date();
  const canAssign = can(me.role, "workorders.assign"), canWork = can(me.role, "maintenance.edit");
  const actions = new Set(allowedActions(wo, { id: me.id, canAssign, canWork }));
  const [activity, people] = await Promise.all([
    getActivity("work_order", wo.id, 50),
    actions.has("assign") ? assignableUsers(wo.facilityId) : Promise.resolve([]),
  ]);
  const late = isLate(wo, now);
  const down = downtimeHours(wo, now);

  return (
    <>
      <PageHeader back={{ href: "/assets/work-orders", label: "Work orders" }}
        title={<span className="flex flex-wrap items-center gap-2">{wo.number} <StatusBadge value={wo.status} /> <StatusBadge value={wo.priority} />{late && <Badge tone="danger">Past response target</Badge>}</span>}
        description={wo.title}
        actions={<>
          {r.roomId && <LinkButton href={`/assets/3d?assetId=${wo.assetId}`} variant="ghost">Show in 3D</LinkButton>}
          <LinkButton href={`/assets/${wo.assetId}`}>Open device</LinkButton>
        </>} />
      <Notice sp={sp} />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Fault">
            {wo.description ? <p className="mb-4 whitespace-pre-wrap text-[14px]">{wo.description}</p> : <p className="mb-4 text-sm text-muted">No details given.</p>}
            <Details items={[
              { label: "Job type", value: maintenanceTypeLabel(wo.type) },
              { label: "Device out of use", value: wo.deviceDown ? <Badge tone="danger">Yes</Badge> : "No" },
              { label: "Reported", value: <>{formatDateTime(wo.reportedAt)}<div className="text-xs text-muted">by {wo.reportedByName ?? "—"}{wo.reporterContact && ` · ${wo.reporterContact}`}</div></> },
              { label: "Respond by", value: formatDateTime(wo.dueAt) },
              { label: "Assigned to", value: r.assigneeName ? <>{r.assigneeName}{r.assigneePhone && <div className="text-xs text-muted">{r.assigneePhone}</div>}</> : <span className="text-muted">Not assigned yet</span> },
              { label: "Started", value: formatDateTime(wo.startedAt) },
              { label: "Completed", value: formatDateTime(wo.completedAt) },
              { label: "Closed", value: formatDateTime(wo.closedAt) },
              { label: "Downtime", value: wo.deviceDown ? `${formatHours(down)}${wo.downtimeEnd ? "" : " so far"}` : "—" },
            ]} />
            {wo.status === "ON_HOLD" && wo.holdReason && <p className="mt-4 rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">On hold: {wo.holdReason}</p>}
          </Panel>

          {(wo.resolution || wo.completedAt) && (
            <Panel title="Resolution">
              <p className="mb-4 whitespace-pre-wrap text-[14px]">{wo.resolution}</p>
              <Details items={[
                { label: "Root cause", value: wo.rootCause },
                { label: "Labour", value: wo.laborHours != null ? `${wo.laborHours} h` : null },
                { label: "Cost", value: wo.cost != null ? formatMoney(wo.cost, wo.currency ?? "EGP") : null },
              ]} />
            </Panel>
          )}

          <Panel title="Device">
            <Details items={[
              { label: "Asset", value: <Link href={`/assets/${wo.assetId}`} className="text-primary hover:underline">{r.tag}</Link> },
              { label: "Device type", value: <Link href={`/catalogue/${r.typeCode}`} className="text-primary hover:underline">{r.typeName}</Link> },
              { label: "Make and model", value: [r.manufacturer, r.model].filter(Boolean).join(" ") || null },
              { label: "Serial number", value: r.serial },
              { label: "Status now", value: <StatusBadge value={r.assetStatus} /> },
              { label: "Criticality", value: r.criticality ? <StatusBadge value={r.criticality} /> : null },
              { label: "Location", value: [r.facilityName, r.departmentName, r.roomName && `${r.roomName} (${r.roomCode})`].filter(Boolean).join(" › ") },
            ]} />
            {r.floorId && <p className="mt-3 text-sm"><Link href={`/assets/map?floorId=${r.floorId}&assetId=${wo.assetId}`} className="text-primary hover:underline">Find it on the floor map</Link></p>}
          </Panel>

          <DocumentsPanel entityType="work_order" entityId={wo.id} returnPath={`/assets/work-orders/${wo.id}`} title="Photos and service reports"
            kinds={["photo", "service_report", "invoice", "certificate", "other"]} emptyHint="Add photos of the fault or the vendor's service report below." />

          <Panel title="History">
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
              <ol className="space-y-3">
                {activity.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p>{e.summary}</p>
                    <p className="text-xs text-muted">{formatDateTime(e.at)}{e.actor && ` · ${e.actor}`}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <aside className="space-y-6">
          {actions.size === 0 && (
            <Panel><p className="text-sm text-muted">{wo.status === "CLOSED" || wo.status === "CANCELLED" ? "This job is finished." : "Nothing for you to do on this job right now."}</p></Panel>
          )}

          {actions.has("start") && (
            <Panel title="Start work">
              <ActionForm action={progressWorkOrderAction}>
                <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="step" value="start" />
                <p className="mb-3 text-sm text-muted">Records the response time{wo.deviceDown ? " and marks the device under maintenance" : ""}.</p>
                <Button>Start work</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("resume") && (
            <Panel title="Resume work">
              <ActionForm action={progressWorkOrderAction}>
                <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="step" value="resume" />
                <Button>Resume work</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("complete") && (
            <Panel title="Complete the job">
              <ActionForm action={completeWorkOrderAction} className="space-y-3">
                <input type="hidden" name="workOrderId" value={wo.id} />
                <Field label="What was done"><Textarea name="resolution" rows={4} required /></Field>
                <Field label="Root cause"><Input name="rootCause" placeholder="e.g. user error, wear, power surge" /></Field>
                <FormGrid cols={2}>
                  <Field label="Labour hours"><Input name="laborHours" type="number" min={0} step="0.25" inputMode="decimal" /></Field>
                  <Field label="Parts and service cost"><Input name="cost" type="number" min={0} step="0.01" inputMode="decimal" /></Field>
                </FormGrid>
                <Field label="Currency"><NativeSelect name="currency" value="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
                {wo.deviceDown && (
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="returnToService" defaultChecked className="mt-1" />
                    <span>Device is back in service</span></label>
                )}
                <Button>Complete job</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("close") && (
            <Panel title="Sign off">
              <ActionForm action={signOffWorkOrderAction} className="space-y-3">
                <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="step" value="close" />
                <Field label="Note (optional)"><Input name="note" maxLength={500} /></Field>
                <Button>Sign off and close</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("assign") && (
            <Panel title={wo.assignedToId ? "Reassign" : "Assign"}>
              {people.length === 0 ? <p className="text-sm text-muted">Nobody with maintenance rights can see this hospital. Give a technician access under Users.</p> : (
                <ActionForm action={assignWorkOrderAction} className="space-y-3">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Field label="Give the job to">
                    <NativeSelect name="assigneeId" required value={wo.assignedToId ?? undefined} placeholder="Choose a person…"
                      options={people.map((u) => ({ value: u.id, label: `${u.name} — ${u.jobTitle ?? ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}` }))} />
                  </Field>
                  <Field label="Priority"><NativeSelect name="priority" value={wo.priority} options={enumOptions(WORK_ORDER_PRIORITIES)} /></Field>
                  <Field label="Note for the technician (optional)"><Input name="note" maxLength={500} /></Field>
                  <Button>{wo.assignedToId ? "Reassign job" : "Assign job"}</Button>
                </ActionForm>
              )}
            </Panel>
          )}

          {actions.has("hold") && (
            <Panel title="Put on hold">
              <ActionForm action={progressWorkOrderAction} className="space-y-3">
                <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="step" value="hold" />
                <Field label="Why"><Input name="holdReason" required maxLength={500} placeholder="e.g. waiting for a spare part from the vendor" /></Field>
                <Button variant="secondary">Put on hold</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("reopen") && (
            <Panel title="Reopen">
              <ActionForm action={signOffWorkOrderAction} className="space-y-3">
                <input type="hidden" name="workOrderId" value={wo.id} /><input type="hidden" name="step" value="reopen" />
                <Field label="Why"><Input name="note" required maxLength={500} placeholder="e.g. fault came back during the test" /></Field>
                <Button variant="secondary">Reopen job</Button>
              </ActionForm>
            </Panel>
          )}

          {actions.has("cancel") && (
            <Panel title={canAssign ? "Cancel" : "Withdraw report"}>
              <ActionForm action={cancelWorkOrderAction} className="space-y-3">
                <input type="hidden" name="workOrderId" value={wo.id} />
                <Field label="Reason"><Input name="reason" required maxLength={500} placeholder="e.g. false alarm, duplicate of another report" /></Field>
                <Button variant="danger">{canAssign ? "Cancel work order" : "Withdraw report"}</Button>
              </ActionForm>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

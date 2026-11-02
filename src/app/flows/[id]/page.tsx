import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, patientFlows } from "@/db/schema";
import { Badge, Button, Field, FormGrid, Input, PageHeader, Panel, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, NativeSelect, Notice } from "@/components/assets/bits";
import { FlowDiagram, fmtMin } from "@/components/flows/flow-diagram";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import {
  checkFlow, FLOW_KIND_LABELS, FLOW_KINDS, STEP_KIND_LABELS, STEP_KINDS, stepVolumes, TRANSPORT_LABELS, TRANSPORTS, URGENCIES, type Step,
} from "@/lib/flows/model";
import { loadFlow, placesOf } from "@/lib/flows/server";
import { deleteFlow, deleteLink, deleteStep, newVersionAction, publishFlow, saveFlowDetails, saveLink, saveStep } from "../actions";

export const dynamic = "force-dynamic";

const STATUS = { DRAFT: ["warn", "Draft"], PUBLISHED: ["ok", "Published"], ARCHIVED: ["neutral", "Archived"] } as const;

export default async function FlowPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePermission("assets.view");
  const { id } = await params; const sp = await searchParams;
  const fid = Number(id);
  if (!Number.isInteger(fid) || fid <= 0) notFound();
  const f = await loadFlow(fid);
  if (!f) notFound();
  await requireFacilityAccess(f.flow.facilityId, me);
  const { flow, steps, links } = f;
  const [fac] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, flow.facilityId));
  const places = await placesOf(flow.facilityId);
  const versions = await db.select({ id: patientFlows.id, version: patientFlows.version, status: patientFlows.status, updatedAt: patientFlows.updatedAt })
    .from(patientFlows).where(and(eq(patientFlows.facilityId, flow.facilityId), eq(patientFlows.lineageId, flow.lineageId ?? flow.id))).orderBy(desc(patientFlows.version));

  const editing = flow.status === "DRAFT" && can(me.role, "flows.edit");
  const mayEdit = can(me.role, "flows.edit");
  const issues = checkFlow(steps, links);
  const errors = issues.filter((i) => i.level === "error");
  const problems = new Set(issues.filter((i) => i.stepKey).map((i) => i.stepKey!));
  const volumes = flow.dailyVolume ? stepVolumes(steps, links, flow.dailyVolume) : null;
  const dept = (did: number | null) => places.departments.find((d) => d.id === did);
  const room = (rid: number | null) => places.rooms.find((r) => r.id === rid);
  const placeOf = (s: Step) => { const r = room(s.roomId); if (r) return `${r.name} · ${r.floorName}`; return dept(s.departmentId)?.name ?? null; };
  const label = (k: string) => steps.find((s) => s.key === k)?.label ?? k;
  const editStep = typeof sp.edit === "string" ? steps.find((s) => s.key === sp.edit) : undefined;
  const editLink = typeof sp.link === "string" ? links.find((l) => l.id === Number(sp.link)) : undefined;
  const stepOpts = steps.map((s) => ({ value: s.key, label: s.label }));
  const deptOpts = places.departments.map((d) => ({ value: d.id, label: d.name }));
  const roomOpts = places.rooms.map((r) => ({ value: r.id, label: `${r.name}${r.code ? ` (${r.code})` : ""} · ${r.floorName}` }));
  const total = steps.reduce((t, s) => t + (s.minutes ?? 0), 0);
  const [tone, statusLabel] = STATUS[flow.status];

  return (
    <>
      <Crumbs items={[{ label: "Patient pathways", href: `/flows?facilityId=${flow.facilityId}` }, { label: flow.name }]} />
      <PageHeader
        title={flow.name}
        description={`${fac?.name ?? ""} · ${FLOW_KIND_LABELS[flow.kind]} pathway · version ${flow.version}${flow.publishedAt ? `, published ${formatDate(flow.publishedAt)}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{statusLabel}</Badge>
            <a href={`/flows/${flow.id}/export`} download className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas">Export file</a>
            {editing && (
              <form action={publishFlow}><input type="hidden" name="flowId" value={flow.id} />
                <Button disabled={errors.length > 0} title={errors.length ? "Fix the problems listed first" : undefined}>Publish</Button></form>
            )}
            {mayEdit && flow.status !== "DRAFT" && (
              <form action={newVersionAction}><input type="hidden" name="flowId" value={flow.id} /><Button>Edit as a new version</Button></form>
            )}
          </div>
        }
      />
      <Notice sp={sp} />
      {flow.status !== "DRAFT" && <p className="mb-4 rounded border border-line bg-sunken px-3 py-2 text-sm text-muted">This version is {statusLabel.toLowerCase()} and can&apos;t be changed{mayEdit ? "; “Edit as a new version” makes a draft copy" : ""}.</p>}

      <Panel title="Pathway">
        <FlowDiagram steps={steps} links={links} volumes={volumes} placeOf={placeOf} problems={problems} />
        <p className="mt-2 text-xs text-muted">{steps.length} steps · {links.length} arrows{total ? ` · ${fmtMin(total)} of step time in all` : ""}{volumes ? ` · ${flow.dailyVolume} patients a day enter` : " · set patients a day to see the load at each step"}. Dashed arrows go back to an earlier step; red ones are urgent.</p>
      </Panel>

      {issues.length > 0 && (
        <Panel title={errors.length ? `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix before publishing` : "Checks"} className="mt-5">
          <ul className="space-y-1 text-sm">
            {issues.map((i, n) => (
              <li key={n} className="flex gap-2"><Badge tone={i.level === "error" ? "danger" : "warn"}>{i.level === "error" ? "Fix" : "Check"}</Badge>
                <span>{i.message}{editing && i.stepKey && <> <Link href={`?edit=${i.stepKey}#step-form`} className="text-primary hover:underline">Edit step</Link></>}</span></li>
            ))}
          </ul>
        </Panel>
      )}
      {!issues.length && <p className="mt-3 text-sm text-ok">All checks pass: every step is reachable, leads to an end, and its arrows add up to 100 %.</p>}

      <Panel title="Steps" className="mt-5">
        <Table>
          <THead><tr><Th>Step</Th><Th>Place</Th><Th align="right">Time</Th><Th align="right">A day</Th><Th>With</Th><Th>Equipment</Th>{editing && <Th />}</tr></THead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.key} className={problems.has(s.key) ? "bg-danger-soft/40" : undefined}>
                <Td><span className="font-semibold">{s.label}</span>{s.kind !== "STEP" && <span className="ml-1 text-xs text-muted">({STEP_KIND_LABELS[s.kind]})</span>}{s.notes && <span className="block text-xs text-muted">{s.notes}</span>}</Td>
                <Td>{placeOf(s) ?? <span className="text-muted">—</span>}</Td>
                <Td align="right">{s.minutes ? fmtMin(s.minutes) : "—"}</Td>
                <Td align="right">{volumes ? Math.round((volumes.get(s.key) ?? 0) * 10) / 10 : "—"}</Td>
                <Td>{s.accompanying ?? "—"}</Td>
                <Td><span className="text-xs">{s.equipment.length ? s.equipment.join(", ") : "—"}</span></Td>
                {editing && (
                  <Td><div className="flex gap-2 text-sm">
                    <Link href={`?edit=${s.key}#step-form`} className="text-primary hover:underline">Edit</Link>
                    <form action={deleteStep}><input type="hidden" name="flowId" value={flow.id} /><input type="hidden" name="key" value={s.key} /><button className="text-danger hover:underline">Remove</button></form>
                  </div></Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        {editing && (
          <div id="step-form" className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-semibold">{editStep ? `Edit “${editStep.label}”` : "Add a step"}{editStep && <Link href="?#step-form" className="ml-2 text-xs font-normal text-primary hover:underline">Add a new one instead</Link>}</h3>
            <ActionForm action={saveStep} key={editStep?.key ?? "new"}>
              <input type="hidden" name="flowId" value={flow.id} /><input type="hidden" name="key" value={editStep?.key ?? ""} />
              <FormGrid cols={3}>
                <Field label="Step name"><Input name="label" required maxLength={120} defaultValue={editStep?.label} placeholder="e.g. CT scan" /></Field>
                <Field label="Kind"><NativeSelect name="kind" value={editStep?.kind ?? "STEP"} options={STEP_KINDS.map((k) => ({ value: k, label: STEP_KIND_LABELS[k] }))} /></Field>
                <Field label="Minutes here" hint="Typical time at this step"><Input name="minutes" type="number" min={0} defaultValue={editStep?.minutes ?? ""} /></Field>
                <Field label="Department"><NativeSelect name="departmentId" value={editStep?.departmentId} placeholder="—" options={deptOpts} /></Field>
                <Field label="Room" hint="Optional; its department fills in"><NativeSelect name="roomId" value={editStep?.roomId} placeholder="—" options={roomOpts} /></Field>
                <Field label="Accompanied by"><Input name="accompanying" maxLength={200} defaultValue={editStep?.accompanying ?? ""} placeholder="e.g. Nurse and porter" /></Field>
                <Field label="Equipment codes" hint="Device type codes, separated by commas" className="sm:col-span-2"><Input name="equipment" maxLength={1000} defaultValue={editStep?.equipment.join(", ")} placeholder="e.g. MON-PAT-TRN, LIF-VEN-TRN" /></Field>
                <Field label="Notes"><Input name="notes" maxLength={2000} defaultValue={editStep?.notes ?? ""} /></Field>
              </FormGrid>
              <div className="mt-3"><Button>{editStep ? "Save step" : "Add step"}</Button></div>
            </ActionForm>
          </div>
        )}
      </Panel>

      <Panel title="Arrows" className="mt-5">
        {links.length === 0 ? <p className="text-sm text-muted">No arrows yet: add one for each way patients move from a step to the next.</p> : (
          <Table>
            <THead><tr><Th>From</Th><Th>To</Th><Th align="right">Share</Th><Th>Transport</Th><Th>Urgency</Th><Th>When</Th>{editing && <Th />}</tr></THead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <Td>{label(l.fromKey)}</Td><Td>{label(l.toKey)}</Td><Td align="right">{l.share} %</Td>
                  <Td>{TRANSPORT_LABELS[l.transport]}</Td><Td>{l.urgency === "URGENT" ? <Badge tone="danger">Urgent</Badge> : "Routine"}</Td><Td>{l.condition ?? "—"}</Td>
                  {editing && (
                    <Td><div className="flex gap-2 text-sm">
                      <Link href={`?link=${l.id}#link-form`} className="text-primary hover:underline">Edit</Link>
                      <form action={deleteLink}><input type="hidden" name="flowId" value={flow.id} /><input type="hidden" name="linkId" value={l.id} /><button className="text-danger hover:underline">Remove</button></form>
                    </div></Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {editing && steps.length >= 2 && (
          <div id="link-form" className="mt-4 border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-semibold">{editLink ? "Edit arrow" : "Add an arrow"}{editLink && <Link href="?#link-form" className="ml-2 text-xs font-normal text-primary hover:underline">Add a new one instead</Link>}</h3>
            <ActionForm action={saveLink} key={editLink?.id ?? "new"}>
              <input type="hidden" name="flowId" value={flow.id} /><input type="hidden" name="linkId" value={editLink?.id ?? ""} />
              <FormGrid cols={3}>
                <Field label="From"><NativeSelect name="fromKey" required value={editLink?.fromKey} placeholder="Choose…" options={stepOpts} /></Field>
                <Field label="To"><NativeSelect name="toKey" required value={editLink?.toKey} placeholder="Choose…" options={stepOpts} /></Field>
                <Field label="Share of patients (%)" hint="Arrows leaving a step add up to 100"><Input name="share" type="number" min={0} max={100} defaultValue={editLink?.share ?? 100} /></Field>
                <Field label="Transport"><NativeSelect name="transport" value={editLink?.transport ?? "FOOT"} options={TRANSPORTS.map((t) => ({ value: t, label: TRANSPORT_LABELS[t] }))} /></Field>
                <Field label="Urgency"><NativeSelect name="urgency" value={editLink?.urgency ?? "ROUTINE"} options={URGENCIES.map((u) => ({ value: u, label: u === "URGENT" ? "Urgent" : "Routine" }))} /></Field>
                <Field label="When" hint="Optional, e.g. “needs surgery”"><Input name="condition" maxLength={200} defaultValue={editLink?.condition ?? ""} /></Field>
              </FormGrid>
              <div className="mt-3"><Button>{editLink ? "Save arrow" : "Add arrow"}</Button></div>
            </ActionForm>
          </div>
        )}
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Details">
          {editing ? (
            <ActionForm action={saveFlowDetails}>
              <input type="hidden" name="flowId" value={flow.id} />
              <FormGrid cols={2}>
                <Field label="Name"><Input name="name" required maxLength={160} defaultValue={flow.name} /></Field>
                <Field label="Kind"><NativeSelect name="kind" value={flow.kind} options={FLOW_KINDS.map((k) => ({ value: k, label: FLOW_KIND_LABELS[k] }))} /></Field>
                <Field label="Patients a day" hint="Entering the pathway"><Input name="dailyVolume" type="number" min={0} defaultValue={flow.dailyVolume ?? ""} /></Field>
              </FormGrid>
              <Field label="Description" className="mt-3"><Textarea name="description" rows={3} maxLength={4000} defaultValue={flow.description ?? ""} /></Field>
              <div className="mt-3"><Button variant="secondary">Save details</Button></div>
            </ActionForm>
          ) : (
            <dl className="space-y-1 text-sm"><div><dt className="inline text-muted">Patients a day: </dt><dd className="inline">{flow.dailyVolume ?? "—"}</dd></div>
              <div><dt className="inline text-muted">Owner: </dt><dd className="inline">{flow.ownerName ?? "—"}</dd></div>
              {flow.description && <p className="mt-2 text-muted">{flow.description}</p>}</dl>
          )}
        </Panel>
        <Panel title="Versions">
          <ul className="space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                {v.id === flow.id ? <b>Version {v.version}</b> : <Link href={`/flows/${v.id}`} className="text-primary hover:underline">Version {v.version}</Link>}
                <Badge tone={STATUS[v.status][0]}>{STATUS[v.status][1]}</Badge><span className="text-xs text-muted">{formatDate(v.updatedAt)}</span>
              </li>
            ))}
          </ul>
          {editing && (
            <form action={deleteFlow} className="mt-4"><input type="hidden" name="flowId" value={flow.id} />
              <button className="text-sm text-danger hover:underline">Delete this draft</button></form>
          )}
        </Panel>
      </div>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [f] = await db.select({ name: patientFlows.name }).from(patientFlows).where(eq(patientFlows.id, Number(id) || 0));
  return { title: f ? f.name : "Pathway" };
}

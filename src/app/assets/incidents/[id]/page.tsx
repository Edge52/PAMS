import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, incidents, incidentVigilance } from "@/db/schema";
import { ActionForm as AssetForm } from "@/components/assets/action-form";
import { quarantineFor } from "@/lib/assets/vigilance-server";
import { placeQuarantineAction, releaseQuarantineAction, saveIncidentVigilanceAction } from "../vigilance-actions";
import { Badge, Details, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/assets/bits";
import { closeProblem, HARM_LABELS, HARM_TONE, HARMS, INCIDENT_STATUS_LABELS, incidentTodos, reportable } from "@/lib/assets/incidents";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { closeIncidentAction, updateIncidentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Incident" };

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ i: incidents, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, typeName: deviceTypes.name, facility: facilities.name })
    .from(incidents).innerJoin(assets, eq(assets.id, incidents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .where(eq(incidents.id, id));
  if (!row) notFound();
  const { i } = row;
  await requireFacilityAccess(i.facilityId, me);
  const sp = await searchParams;
  const manage = can(me.role, "incidents.manage"), closed = i.status === "CLOSED";
  const todos = incidentTodos(i, todayISO()), blocked = closeProblem(i);
  const log = await getActivity("incident", i.id, 20);
  const [[v], hold] = await Promise.all([db.select().from(incidentVigilance).where(eq(incidentVigilance.incidentId, i.id)), quarantineFor(i.assetId)]);

  return (
    <>
      <PageHeader title={<><span className="font-mono text-[26px]">{i.number}</span> {i.title}</>} back={{ href: "/assets/incidents", label: "Incidents" }}
        description={<>{row.facility} · happened {formatDateTime(i.occurredAt)} · reported by {i.reportedByName ?? "someone"} on {formatDate(i.createdAt)}</>}
        actions={<>
          <LinkButton href={`/assets/incidents/${i.id}/report`}>EDA report (Annex 2)</LinkButton>
          {can(me.role, "workorders.report") && !i.workOrderId && <LinkButton href={`/assets/work-orders/new?assetId=${i.assetId}`}>Raise a work order</LinkButton>}
        </>} />
      <Notice sp={sp} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={closed ? "ok" : i.status === "OPEN" ? "warn" : "info"}>{INCIDENT_STATUS_LABELS[i.status]}</Badge>
        <Badge tone={HARM_TONE[i.harm]}>{HARM_LABELS[i.harm]}</Badge>
        {reportable(i.harm) && <Badge tone="danger">Reportable to the EDA and the manufacturer</Badge>}
        {i.deviceQuarantined ? <Badge tone="primary">Device quarantined</Badge> : <Badge tone="neutral">Device not quarantined</Badge>}
        {i.patientInvolved && <Badge tone="neutral">Patient involved</Badge>}
      </div>
      {todos.length > 0 && (
        <Panel title="Still to do" className="mb-5">
          <ul className="space-y-1.5 text-sm">{todos.map((t) => <li key={t.text} className={t.level === "danger" ? "font-semibold text-danger" : undefined}>{t.text}</li>)}</ul>
        </Panel>
      )}
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        <div className="space-y-5">
          <Panel title="What happened">
            <p className="whitespace-pre-line text-sm">{i.description}</p>
            {i.immediateAction && <><p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Done straight away</p><p className="mt-1 whitespace-pre-line text-sm">{i.immediateAction}</p></>}
          </Panel>
          <Panel title="Investigation and who was told">
            {manage && !closed ? (
              <ActionForm action={updateIncidentAction} className="space-y-4">
                <input type="hidden" name="id" value={i.id} />
                <Field label="Root cause" hint="Device fault, use error, accessory, environment, maintenance, or not found."><Textarea name="rootCause" rows={3} defaultValue={i.rootCause ?? ""} /></Field>
                <Field label="Corrective action" hint="What was done so it doesn't happen again."><Textarea name="correctiveAction" rows={3} defaultValue={i.correctiveAction ?? ""} /></Field>
                <FormGrid cols={2}>
                  <Field label="Harm"><Select name="harm" defaultValue={i.harm} options={HARMS.map((h) => ({ value: h, label: HARM_LABELS[h] }))} /></Field>
                  <Field label="Report to the EDA by" hint="Take the time limit from the EDA's medical device vigilance guideline."><Input type="date" name="reportBy" defaultValue={i.reportBy ?? ""} /></Field>
                  <Field label="Manufacturer or agent told on"><Input type="date" name="manufacturerNotifiedOn" defaultValue={i.manufacturerNotifiedOn ?? ""} max={todayISO()} /></Field>
                  <Field label="EDA told on"><Input type="date" name="edaNotifiedOn" defaultValue={i.edaNotifiedOn ?? ""} max={todayISO()} /></Field>
                  <Field label="EDA reference" hint="The number the EDA gave the report, if any."><Input name="edaReference" defaultValue={i.edaReference ?? ""} maxLength={120} /></Field>
                </FormGrid>
                <label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="deviceQuarantined" className="size-5" defaultChecked={i.deviceQuarantined} /> The device is out of use and kept as found</label>
                <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
              </ActionForm>
            ) : (
              <Details items={[
                { label: "Root cause", value: i.rootCause }, { label: "Corrective action", value: i.correctiveAction },
                { label: "Manufacturer told on", value: i.manufacturerNotifiedOn ? formatDate(i.manufacturerNotifiedOn) : null },
                { label: "EDA told on", value: i.edaNotifiedOn ? formatDate(i.edaNotifiedOn) : null }, { label: "EDA reference", value: i.edaReference },
                { label: "Report by", value: i.reportBy ? formatDate(i.reportBy) : null },
              ]} />
            )}
          </Panel>
          {manage && (
            <Panel title={closed ? "Closed" : "Close the incident"}>
              {closed ? <p className="mb-3 text-sm text-muted">Closed by {i.closedByName ?? "someone"} on {i.closedAt ? formatDate(i.closedAt) : "—"}.</p>
                : blocked ? <p className="text-sm text-muted">{blocked}</p> : <p className="mb-3 text-sm text-muted">The cause and the action are recorded{reportable(i.harm) ? ", and the manufacturer and the EDA were told" : ""}.</p>}
              {(closed || !blocked) && (
                <ActionForm action={closeIncidentAction} confirm={closed ? "Reopen this incident so it can be changed?" : "Close this incident? It can be reopened later."}>
                  <input type="hidden" name="id" value={i.id} />{closed && <input type="hidden" name="reopen" value="1" />}
                  <SubmitButton variant={closed ? "secondary" : "primary"}>{closed ? "Reopen" : "Close the incident"}</SubmitButton>
                </ActionForm>
              )}
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Device">
            <Details items={[
              { label: "Asset tag", value: <Link href={`/assets/${i.assetId}`} className="font-mono text-primary hover:underline">{row.tag}</Link> },
              { label: "Type", value: row.typeName }, { label: "Make and model", value: [row.manufacturer, row.model].filter(Boolean).join(" ") || null }, { label: "Serial number", value: row.serial },
            ]} />
          </Panel>
          <Panel title="Kept as found">
            {hold ? (
              <>
                <p className="text-sm"><b className="text-danger">Quarantined</b> since {formatDateTime(hold.placedAt)}{hold.placedByName ? ` by ${hold.placedByName}` : ""}: {hold.reason}{hold.keptAt ? `. Kept at ${hold.keptAt}.` : "."}</p>
                <p className="mt-1 text-xs text-muted">No repair, maintenance or disposal until it is released.</p>
                {manage && <AssetForm action={releaseQuarantineAction} className="mt-3 space-y-2">
                  <input type="hidden" name="assetId" value={i.assetId} />
                  <Field label="Why it can be released"><Input name="releaseReason" required maxLength={500} placeholder="e.g. the maker inspected it; EDA report closed" /></Field>
                  <SubmitButton variant="secondary">Release the device</SubmitButton>
                </AssetForm>}
              </>
            ) : manage ? (
              <AssetForm action={placeQuarantineAction} className="space-y-2">
                <input type="hidden" name="assetId" value={i.assetId} /><input type="hidden" name="incidentId" value={i.id} />
                <p className="text-sm text-muted">Keep the device as found for the maker and the EDA: repair work and disposal are blocked until it is released.</p>
                <Field label="Reason"><Input name="reason" required maxLength={300} defaultValue={`Incident ${i.number}`} /></Field>
                <Field label="Kept at"><Input name="keptAt" maxLength={200} placeholder="e.g. Biomedical store, locked cage 2" /></Field>
                <SubmitButton variant="secondary">Keep as found</SubmitButton>
              </AssetForm>
            ) : <p className="text-sm text-muted">Not quarantined.</p>}
          </Panel>
          {manage && (
            <Panel title="EDA report details">
              <AssetForm action={saveIncidentVigilanceAction} className="space-y-2">
                <input type="hidden" name="incidentId" value={i.id} />
                <Field label="Maker's report reference"><Input name="makerReference" maxLength={120} defaultValue={v?.makerReference ?? ""} /></Field>
                <Field label="Lot or batch number"><Input name="lotNumber" maxLength={120} defaultValue={v?.lotNumber ?? ""} /></Field>
                <Field label="UDI" hint="Blank uses the device's own UDI."><Input name="udi" maxLength={200} defaultValue={v?.udi ?? ""} /></Field>
                <Field label="Where the device is kept"><Input name="keptAt" maxLength={200} defaultValue={v?.keptAt ?? hold?.keptAt ?? ""} /></Field>
                <Field label="Reporter's job title"><Input name="reporterJobTitle" maxLength={160} defaultValue={v?.reporterJobTitle ?? ""} /></Field>
                <Field label="Reporter's phone"><Input name="reporterPhone" maxLength={60} defaultValue={v?.reporterPhone ?? ""} /></Field>
                <Field label="Reporter's email"><Input type="email" name="reporterEmail" maxLength={160} defaultValue={v?.reporterEmail ?? ""} /></Field>
                <SubmitButton variant="secondary">Save details</SubmitButton>
              </AssetForm>
            </Panel>
          )}
          <Panel title="History">
            {log.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">{log.map((l) => <li key={l.id}><span className="text-muted">{formatDateTime(l.at)} · {l.actor ?? "system"}</span><span className="block">{l.summary}</span></li>)}</ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

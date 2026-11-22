import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, radiationLicences, rooms } from "@/db/schema";
import { Badge, Details, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/assets/bits";
import { DocumentsPanel } from "@/components/documents-panel";
import { LICENCE_STATE_LABELS, licenceState, TONE } from "@/lib/assets/radiation";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { retireLicenceAction, updateLicenceAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "ENRRA licence" };

/** One ENRRA licence (wave 37): details, the licence document, renewal. */
export default async function LicencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ l: radiationLicences, roomName: rooms.name, roomCode: rooms.code, tag: assets.assetTag }).from(radiationLicences)
    .leftJoin(rooms, eq(rooms.id, radiationLicences.roomId)).leftJoin(assets, eq(assets.id, radiationLicences.assetId)).where(eq(radiationLicences.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.l.facilityId, me);
  const sp = await searchParams;
  const l = r.l, state = licenceState(l.expiresOn, todayISO());
  const canEdit = can(me.role, "maintenance.edit");
  const path = `/assets/radiation/licences/${l.id}`;
  const activity = await getActivity("radiation_licence", l.id, 20);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={`ENRRA licence ${l.licenceNumber}`} back={{ href: `/assets/radiation?facilityId=${l.facilityId}&tab=licences`, label: "Radiation safety" }}
        description={l.active ? "Egyptian Nuclear and Radiological Regulatory Authority licence." : "No longer in use."} />
      <Notice sp={sp} />
      <Panel title="Licence" actions={l.active ? <Badge tone={TONE[state]}>{LICENCE_STATE_LABELS[state]}</Badge> : <Badge>Not in use</Badge>}>
        <Details items={[
          { label: "Room", value: r.roomName ? <Link href={`/assets/map?roomId=${l.roomId}`} className="text-primary hover:underline">{r.roomName} <span className="font-mono text-xs">{r.roomCode}</span></Link> : null },
          { label: "Device", value: r.tag ? <Link href={`/assets/${l.assetId}`} className="font-mono text-primary hover:underline">{r.tag}</Link> : null },
          { label: "Scope", value: l.scope },
          { label: "Issued", value: l.issuedOn ? formatDate(l.issuedOn) : null },
          { label: "Expires", value: formatDate(l.expiresOn) },
          { label: "Notes", value: l.notes },
        ]} />
      </Panel>
      <DocumentsPanel entityType="radiation_licence" entityId={l.id} returnPath={path} title="Licence document" kinds={["licence", "other"]} emptyHint="Scan the signed licence and attach it here." />
      {canEdit && <Panel title="Renew or correct">
        <ActionForm action={updateLicenceAction} className="space-y-3">
          <input type="hidden" name="id" value={l.id} />
          <FormGrid cols={2}>
            <Field label="Licence number"><Input name="licenceNumber" required maxLength={80} defaultValue={l.licenceNumber} /></Field>
            <Field label="Expires on"><Input type="date" name="expiresOn" required defaultValue={l.expiresOn} /></Field>
            <Field label="Issued on"><Input type="date" name="issuedOn" defaultValue={l.issuedOn ?? ""} /></Field>
            <Field label="Scope"><Input name="scope" maxLength={500} defaultValue={l.scope ?? ""} /></Field>
          </FormGrid>
          <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={l.notes ?? ""} /></Field>
          <p className="text-xs text-muted">After a renewal, attach the new licence above.</p>
          <SubmitButton variant="secondary">Save licence</SubmitButton>
        </ActionForm>
        <ActionForm action={retireLicenceAction} className="mt-4 border-t border-line pt-4" confirm={l.active ? "Stop listing this licence? Do this when it is replaced or the room no longer uses radiation." : undefined}
          confirmLabel={l.active ? "Stop listing it" : undefined}>
          <input type="hidden" name="id" value={l.id} />
          <SubmitButton variant={l.active ? "danger" : "secondary"}>{l.active ? "No longer in use" : "List it again"}</SubmitButton>
        </ActionForm>
      </Panel>}
      {activity.length > 0 && <Panel title="Activity">
        <ol className="space-y-2 text-sm">{activity.map((a) => <li key={a.id}><span className="text-xs text-muted">{formatDate(a.at)}{a.actor ? ` · ${a.actor}` : ""}</span><br />{a.summary}</li>)}</ol>
      </Panel>}
    </div>
  );
}

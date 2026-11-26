import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competencies, deviceTypes, users } from "@/db/schema";
import { Badge, Button, Details, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { DocumentsPanel } from "@/components/documents-panel";
import { COMPETENCY_STATE_LABELS, COMPETENCY_TONE, recordState, TRAINING_KIND_LABELS, TRAINING_KINDS, type TrainingKind } from "@/lib/assets/competency";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { retireCompetencyAction, updateCompetencyAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training record" };

/** One training record (wave 40): details, the certificate and its history. */
export default async function CompetencyRecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const [r] = await db.select({ c: competencies, person: users.name, typeName: deviceTypes.name, typeCode: deviceTypes.code, level: deviceTypes.level })
    .from(competencies).innerJoin(users, eq(users.id, competencies.userId)).innerJoin(deviceTypes, eq(deviceTypes.id, competencies.deviceTypeId))
    .where(eq(competencies.id, Number(id)));
  if (!r) notFound();
  const c = r.c;
  const canEdit = can(me.role, "workorders.assign");
  const state = recordState(c, todayISO());
  const activity = await getActivity("competency", c.id, 20);
  const path = `/assets/competency/${c.id}`;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader back={{ href: `/assets/competency?userId=${c.userId}`, label: "Technician competency" }} title={`${r.person}: ${r.typeName}`}
        description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{r.typeCode}{r.level < 3 ? " (every type in this category)" : ""}</span>{c.active ? <Badge tone={COMPETENCY_TONE[state]}>{COMPETENCY_STATE_LABELS[state]}</Badge> : <Badge tone="neutral">Withdrawn</Badge>}</span>} />
      <Notice sp={sp} />
      <Panel title="Record">
        <Details items={[
          { label: "Training", value: TRAINING_KIND_LABELS[c.kind as TrainingKind] ?? c.kind },
          { label: "Trained on", value: formatDate(c.trainedOn) },
          { label: "Expires", value: c.expiresOn ? formatDate(c.expiresOn) : "Does not expire" },
          { label: "Authorised to service", value: c.authorised ? "Yes" : "No" },
          { label: "Trainer or course", value: c.trainer },
          { label: "Certificate number", value: c.certificateRef },
          { label: "Recorded by", value: c.recordedByName },
        ]} />
        {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{c.notes}</p>}
      </Panel>
      <DocumentsPanel entityType="competency" entityId={c.id} returnPath={path} title="Certificate" kinds={["certificate", "other"]} emptyHint="Scan the training certificate and attach it here." />
      {canEdit && (
        <Panel title="Correct or renew">
          <ActionForm action={updateCompetencyAction} className="space-y-3">
            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="userId" value={c.userId} /><input type="hidden" name="deviceTypeId" value={c.deviceTypeId} />
            <FormGrid cols={2}>
              <Field label="Training"><NativeSelect name="kind" value={c.kind} options={TRAINING_KINDS.map((k) => ({ value: k, label: TRAINING_KIND_LABELS[k] }))} /></Field>
              <Field label="Trained on"><Input type="date" name="trainedOn" required defaultValue={c.trainedOn} /></Field>
              <Field label="Expires on"><Input type="date" name="expiresOn" defaultValue={c.expiresOn ?? ""} /></Field>
              <Field label="Trainer or course"><Input name="trainer" maxLength={160} defaultValue={c.trainer ?? ""} /></Field>
              <Field label="Certificate number"><Input name="certificateRef" maxLength={120} defaultValue={c.certificateRef ?? ""} /></Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="authorised" defaultChecked={c.authorised} className="size-5" /> Authorised to service this type alone</label>
            <Field label="Notes"><Textarea name="notes" rows={2} defaultValue={c.notes ?? ""} /></Field>
            <SubmitButton variant="secondary">Save changes</SubmitButton>
          </ActionForm>
          <ActionForm action={retireCompetencyAction} className="mt-4">
            <input type="hidden" name="id" value={c.id} />
            <Button variant="secondary">{c.active ? "Withdraw this record" : "Count this record again"}</Button>
          </ActionForm>
        </Panel>
      )}
      <Panel title="History">
        {activity.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet.</p> : (
          <ol className="space-y-2">{activity.map((e) => <li key={e.id} className="text-sm"><p>{e.summary}</p><p className="text-xs text-muted">{formatDateTime(e.at)}{e.actor && ` · ${e.actor}`}</p></li>)}</ol>
        )}
      </Panel>
    </div>
  );
}

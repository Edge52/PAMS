import Link from "next/link";
import { notFound } from "next/navigation";
import { alias } from "drizzle-orm/pg-core";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, deviceTypes, facilities, trainingAttendees, trainingSessions } from "@/db/schema";
import { Badge, Details, Field, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { Notice } from "@/components/assets/bits";
import { refreshDue, TRAINING_KIND_LABELS } from "@/lib/assets/training";
import { trainingValidMonths, usersOfFacility } from "@/lib/assets/training-server";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { getActivity } from "@/lib/server-utils";
import { addAttendeesAction, removeAttendeeAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Training session" };

const attDept = alias(departments, "att_dept");

export default async function TrainingSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const sp = await searchParams;
  const [r] = await db.select({ s: trainingSessions, typeName: deviceTypes.name, typeCode: deviceTypes.code, department: departments.name, facility: facilities.name })
    .from(trainingSessions).innerJoin(deviceTypes, eq(deviceTypes.id, trainingSessions.deviceTypeId)).innerJoin(facilities, eq(facilities.id, trainingSessions.facilityId))
    .leftJoin(departments, eq(departments.id, trainingSessions.departmentId)).where(eq(trainingSessions.id, Number(id)));
  if (!r) notFound();
  await requireFacilityAccess(r.s.facilityId, me);
  const s = r.s, canEdit = can(me.role, "maintenance.edit");
  const [people, months, activity] = await Promise.all([
    db.select({ a: trainingAttendees, dept: attDept.name }).from(trainingAttendees).leftJoin(attDept, eq(attDept.id, trainingAttendees.departmentId))
      .where(eq(trainingAttendees.sessionId, s.id)).orderBy(asc(trainingAttendees.name)),
    trainingValidMonths(),
    getActivity("training", s.id, 20),
  ]);
  const accounts = canEdit ? (await usersOfFacility(s.facilityId)).filter((u) => !people.some((p) => p.a.userId === u.id)) : [];
  const due = refreshDue(s.heldOn, months);
  const path = `/assets/training/${s.id}`;
  return (
    <>
      <PageHeader back={{ href: "/assets/training", label: "User training" }} title={`${r.typeName}: ${TRAINING_KIND_LABELS[s.kind].toLowerCase()} training`}
        description={`${formatDate(s.heldOn)} · ${s.trainer} · ${r.facility}`} />
      <Notice sp={sp} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Session">
            <Details items={[
              { label: "Device type", value: <Link href={`/catalogue/${r.typeCode}`} className="text-primary hover:underline">{r.typeName}</Link> },
              { label: "Kind", value: TRAINING_KIND_LABELS[s.kind] },
              { label: "Date", value: formatDate(s.heldOn) },
              { label: "Trainer", value: s.trainer },
              { label: "For department", value: r.department },
              { label: "Valid until", value: <>{formatDate(due)} {due < todayISO() && <Badge tone="warn">Refresher due</Badge>}</> },
              { label: "Notes", value: s.notes },
              { label: "Recorded by", value: s.createdByName },
            ]} />
          </Panel>
          <Panel title={`Attended (${people.length})`} padded={false}>
            {people.length === 0 ? <p className="p-5 text-sm text-muted">Nobody on the list yet.</p> : (
              <ul className="divide-y divide-line">
                {people.map(({ a, dept }) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 font-semibold">{a.name}{a.userId && <span className="ml-2 text-xs font-normal text-muted">PAMS account</span>}</span>
                    <span className="text-muted">{dept ?? a.departmentText ?? r.department ?? "No department"}</span>
                    {canEdit && (
                      <ActionForm action={removeAttendeeAction} className="inline" confirm={`Remove ${a.name} from this session?`}>
                        <input type="hidden" name="attendeeId" value={a.id} />
                        <SubmitButton variant="danger" className="min-h-6 px-2 py-0 text-xs">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <ActionForm action={addAttendeesAction} className="space-y-3 border-t border-line p-5">
                <input type="hidden" name="sessionId" value={s.id} />
                {accounts.length > 0 && (
                  <details className="rounded-[var(--radius-control)] border border-line px-3 py-2">
                    <summary className="min-h-6 cursor-pointer text-sm text-primary">Add people with a PAMS account</summary>
                    <ul className="mt-2 grid max-h-60 gap-1 overflow-y-auto sm:grid-cols-2">
                      {accounts.map((u) => <li key={u.id}><label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="userIds" value={u.id} className="size-5" />{u.name}</label></li>)}
                    </ul>
                  </details>
                )}
                <Field label="Add other people" hint="One per line: name, then a comma and the department if it differs."><Textarea name="attendees" rows={3} /></Field>
                <SubmitButton variant="secondary">Add to the list</SubmitButton>
              </ActionForm>
            )}
          </Panel>
          <DocumentsPanel entityType="training" entityId={s.id} returnPath={path} title="Sign-in sheet" kinds={["sign_in_sheet", "other"]} emptyHint="Scan or photograph the signed attendance sheet and attach it here." />
        </div>
        <aside>
          <Panel title="Activity">
            {activity.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
              <ol className="space-y-2.5 text-sm">
                {activity.map((ev) => <li key={ev.id}><span className="text-xs text-muted">{formatDate(ev.at)}{ev.actor ? ` · ${ev.actor}` : ""}</span><br />{ev.summary}</li>)}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}

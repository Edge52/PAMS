import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, facilities } from "@/db/schema";
import { Button, EmptyState, Field, FormGrid, Input, PageHeader, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { DeviceTypeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { TRAINING_KINDS, TRAINING_KIND_LABELS } from "@/lib/assets/training";
import { usersOfFacility } from "@/lib/assets/training-server";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { createTrainingAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record training" };

export default async function NewTrainingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("maintenance.edit");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Record training" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const [types, depts, people] = await Promise.all([
    deviceTypeOptions(),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
    usersOfFacility(facilityId),
  ]);
  const today = todayISO();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Record training" back={{ href: "/assets/training", label: "User training" }}
        description="One session on one device type. After saving, attach the signed sheet." />
      {facs.length > 1 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <Field label="Hospital"><Select name="facilityId" defaultValue={String(facilityId)} options={facs.map((f) => ({ value: String(f.id), label: f.name }))} /></Field>
          <Button variant="secondary">Change hospital</Button>
        </form>
      )}
      <Panel>
        <ActionForm action={createTrainingAction} className="space-y-5">
          <input type="hidden" name="facilityId" value={facilityId} />
          <FormGrid cols={2}>
            <Field label="Device type"><DeviceTypeSelect types={types} value={Number(sp.deviceTypeId) || null} required /></Field>
            <Field label="For department" hint="People typed without a department count here."><Select name="departmentId" defaultValue={sp.departmentId ?? ""} placeholder="—" options={depts.map((d) => ({ value: String(d.id), label: d.name }))} /></Field>
            <Field label="Date"><Input type="date" name="heldOn" required defaultValue={today} max={today} /></Field>
            <Field label="Kind"><Select name="kind" defaultValue="INITIAL" options={TRAINING_KINDS.map((k) => ({ value: k, label: TRAINING_KIND_LABELS[k] }))} /></Field>
            <Field label="Trainer" hint="A name, or the supplier's engineer."><Input name="trainer" required maxLength={200} defaultValue={me.name} /></Field>
          </FormGrid>
          <fieldset>
            <legend className="mb-1 text-sm font-bold">Who attended</legend>
            {people.length > 0 && (
              <details className="mb-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
                <summary className="min-h-6 cursor-pointer text-sm text-primary">People with a PAMS account ({people.length})</summary>
                <ul className="mt-2 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">
                  {people.map((u) => (
                    <li key={u.id}><label className="flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="userIds" value={u.id} className="size-5" />{u.name}{u.jobTitle && <span className="text-xs text-muted">{u.jobTitle}</span>}</label></li>
                  ))}
                </ul>
              </details>
            )}
            <Field label="Other people" hint="One per line: name, then a comma and the department if it differs (e.g. Mona Adel, Intensive Care Unit).">
              <Textarea name="attendees" rows={5} />
            </Field>
          </fieldset>
          <Field label="Notes"><Textarea name="notes" rows={2} maxLength={2000} placeholder="What was covered, e.g. set-up, alarms, cleaning, what to do on a fault" /></Field>
          <SubmitButton pendingLabel="Saving…">Save the session</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}

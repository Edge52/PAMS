import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, users } from "@/db/schema";
import { Button, Details, EmptyState, Field, FormGrid, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { SubmitButton } from "@/components/ui/action-form";
import { AutoSubmit } from "@/components/auto-submit";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { safetyContacts } from "@/lib/assets/vigilance-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { saveSafetyContactsAction } from "../vigilance-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Safety contacts" };

/**
 * The hospital's medical-device safety contact officer, named to the EDA (GL.CAP.Care.040), and its radiation
 * protection officer (wave 40). Shown on the EDA incident report; the radiation protection officer sees declared
 * pregnancies on the dosimetry records.
 */
export default async function SafetyContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.id));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || null) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Safety contacts" /><EmptyState title="No hospital to show">You don&apos;t have access to any hospital yet.</EmptyState></>;
  await requireFacilityAccess(facilityId, me);
  const c = await safetyContacts(facilityId);
  const canEdit = can(me.role, "settings.manage");
  const people = canEdit ? await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.active, true))).orderBy(asc(users.name)).limit(1000) : [];
  const nameOf = async (uid: number | null | undefined) => (uid ? (await db.select({ n: users.name }).from(users).where(eq(users.id, uid)))[0]?.n ?? null : null);
  const rpo = await nameOf(c?.rpoUserId);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader back={{ href: "/assets/incidents", label: "Incidents" }} title="Safety contacts"
        description="The medical-device safety contact officer the hospital named to the Egyptian Drug Authority (EDA guideline GL.CAP.Care.040), and the radiation protection officer." />
      <Notice sp={sp} />
      {facs.length > 1 && (
        <form className="flex flex-wrap items-end gap-2"><AutoSubmit />
          <label><span className="sr-only">Hospital</span><NativeSelect name="facilityId" aria-label="Hospital" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></label>
          <Button variant="secondary">Show</Button></form>
      )}
      <Panel title="On record">
        <Details items={[
          { label: "Safety contact officer", value: c?.officerName }, { label: "Job title", value: c?.officerJobTitle },
          { label: "Phone", value: c?.officerPhone }, { label: "Email", value: c?.officerEmail },
          { label: "Radiation protection officer", value: rpo },
          { label: "Last changed", value: c ? `${formatDateTime(c.updatedAt)}${c.updatedByName ? ` by ${c.updatedByName}` : ""}` : null },
        ]} />
      </Panel>
      {canEdit && (
        <Panel title="Change">
          <ActionForm action={saveSafetyContactsAction} className="space-y-3">
            <input type="hidden" name="facilityId" value={facilityId} />
            <FormGrid cols={2}>
              <Field label="Officer's account" hint="Optional: their name is filled in from it."><NativeSelect name="officerUserId" value={c?.officerUserId ?? undefined} placeholder="No account" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
              <Field label="Officer's name"><Input name="officerName" maxLength={160} defaultValue={c?.officerName ?? ""} /></Field>
              <Field label="Job title"><Input name="officerJobTitle" maxLength={160} defaultValue={c?.officerJobTitle ?? ""} /></Field>
              <Field label="Phone"><Input name="officerPhone" maxLength={60} defaultValue={c?.officerPhone ?? ""} /></Field>
              <Field label="Email"><Input type="email" name="officerEmail" maxLength={160} defaultValue={c?.officerEmail ?? ""} /></Field>
              <Field label="Radiation protection officer" hint="Sees declared pregnancies on dosimetry records, with administrators."><NativeSelect name="rpoUserId" value={c?.rpoUserId ?? undefined} placeholder="Not named" options={people.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            </FormGrid>
            <SubmitButton variant="secondary">Save contacts</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Field, Input, PageHeader, Panel, TabLinks } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ChannelGrid } from "@/components/notifications/channel-grid";
import { DeputyPanel } from "@/components/notifications/deputy-panel";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { currentDelegations } from "@/lib/approvals/delegation-server";
import { escalationDays, ESCALATION_ENTITIES } from "@/lib/approvals/escalation";
import { ackTargets, FAULT_CLASS_LABELS, FAULT_CLASSES, targetLabel } from "@/lib/assets/fault-escalation";
import { todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { saveEscalationAction, saveRoleDefaultsAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications and escalation" };

const ENTITY_LABEL: Record<string, string> = { PO: "Purchase orders", BOQ: "BOQs", AWARD: "Awards", DISPOSAL: "Disposals", EQUIPMENT_PLAN: "Equipment plans" };

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const me = await requirePermission("settings.manage");
  const sp = await searchParams;
  const role: Role = (ROLES as readonly string[]).includes(sp.role ?? "") ? (sp.role as Role) : "BIOMEDICAL";
  const today = todayISO();
  const [s, dels, people] = await Promise.all([
    getSettings(), currentDelegations(today),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.active, true)).orderBy(asc(users.name)).limit(1000),
  ]);
  const targets = ackTargets(s.faultAckMinutes);
  const roleSet = s.notificationRoleDefaults?.[role] ?? {};
  return (
    <>
      <PageHeader title="Notifications and escalation" description="Defaults per role, how long approvals and fault reports may wait, and deputies for anyone. Each person can change their own choices under Your account › Notifications." />
      <p className="mb-4 text-sm"><Link href="/admin/settings" className="font-semibold text-primary hover:underline">Back to settings</Link></p>
      <div className="space-y-6">
        <Panel title="Defaults per role">
          <TabLinks active={role} tabs={ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r], href: `/admin/notifications?role=${r}` }))} />
          <ActionForm action={saveRoleDefaultsAction} className="mt-4 space-y-6">
            <input type="hidden" name="role" value={role} />
            <ChannelGrid values={roleSet} fallback={() => "BOTH"} fallbackLabel="Usual" />
            <SubmitButton>Save defaults for {ROLE_LABELS[role].toLowerCase()}</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel title="Escalation">
          <ActionForm action={saveEscalationAction} className="space-y-6">
            <fieldset>
              <legend className="mb-1 text-sm font-bold">Approvals</legend>
              <p className="mb-3 text-sm text-muted">After this many working days (Friday, Saturday and public holidays off) the approver is reminded; at twice that the director is told (the administrators, when the step is the director&apos;s). <Link href="/admin/holidays" className="font-semibold text-primary hover:underline">Public holidays</Link></p>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {ESCALATION_ENTITIES.map((e) => (
                  <Field key={e} label={ENTITY_LABEL[e]}><Input type="number" name={`days_${e}`} min={1} max={60} required defaultValue={escalationDays(e, s.approvalEscalationDays)} /></Field>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-sm font-bold">Fault reports: minutes to pick up</legend>
              <p className="mb-3 text-sm text-muted">Past the target, the on-duty biomedical team is told again; at twice the target, the biomedical lead. 1,440 minutes or more counts in working days. The on-duty list is under Work orders › On call.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {FAULT_CLASSES.map((c) => (
                  <Field key={c} label={FAULT_CLASS_LABELS[c]} hint={`Now ${targetLabel(targets[c])}`}><Input type="number" name={`min_${c}`} min={5} max={14400} required defaultValue={targets[c]} /></Field>
                ))}
              </div>
            </fieldset>
            <SubmitButton>Save escalation settings</SubmitButton>
          </ActionForm>
        </Panel>

        <DeputyPanel meId={me.id} today={today} forAnyone people={people}
          rows={dels.map((r) => ({ id: r.d.id, userId: r.d.userId, userName: r.userName, deputyId: r.d.deputyId, deputyName: r.deputyName, startsOn: r.d.startsOn, endsOn: r.d.endsOn, reason: r.d.reason, setByName: r.d.setByName }))} />
      </div>
    </>
  );
}

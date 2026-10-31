import { Details, Field, Input, PageHeader, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { changeOwnPassword } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const me = await requireUser();
  return (
    <>
      <PageHeader title="Your account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Details">
          <Details items={[
            { label: "Name", value: me.name }, { label: "Email", value: me.email },
            { label: "Role", value: ROLE_LABELS[me.role] }, { label: "Job title", value: me.jobTitle ?? "—" },
          ]} />
          <p className="mt-3 text-xs text-muted">An administrator can change your name, role and facilities.</p>
        </Panel>
        <Panel title="Change password">
          <ActionForm action={changeOwnPassword} className="space-y-4">
            <Field label="Current password"><Input type="password" name="current" required autoComplete="current-password" /></Field>
            <Field label="New password" hint="At least 8 characters"><Input type="password" name="password" required autoComplete="new-password" /></Field>
            <Field label="New password again"><Input type="password" name="confirm" required autoComplete="new-password" /></Field>
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}

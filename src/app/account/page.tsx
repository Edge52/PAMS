import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Badge, Details, Field, Input, PageHeader, Panel } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { twoStepRequiredFor } from "@/lib/auth/two-step";
import { NewBackupCodesForm } from "@/components/two-step-forms";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { changeOwnPassword, newBackupCodeSet, startTwoStep, turnOffTwoStep } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const me = await requireUser();
  const [two] = await db.select({ on: users.totpEnabledAt, left: users.backupCodeHashes, hasPassword: users.passwordHash }).from(users).where(eq(users.id, me.id));
  const required = await twoStepRequiredFor(me.role);
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
        <Panel title="Two-step sign-in" className="lg:col-span-2">
          {two?.on ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-3">
                <p className="text-sm"><Badge tone="ok">On</Badge> <span className="ml-1">since {formatDate(two.on)}. Signing in needs your password and a code from your authenticator app.</span></p>
                <p className="text-sm text-muted">{two.left.length} backup code{two.left.length === 1 ? "" : "s"} left.{two.left.length <= 2 ? " Make a new set soon." : ""}</p>
                <NewBackupCodesForm action={newBackupCodeSet} />
              </div>
              {required ? <p className="text-sm text-muted">Your hospital requires two-step sign-in, so it can&apos;t be switched off. New phone? Ask an administrator to reset it, then set it up again when you next sign in.</p> : (
                <ActionForm action={turnOffTwoStep} className="space-y-3" confirm="Switch off two-step sign-in? Your account will be protected by your password only.">
                  <Field label="Your password" hint="To switch it off, or before moving to a new phone."><Input type="password" name="current" required autoComplete="current-password" /></Field>
                  <SubmitButton variant="secondary">Switch off</SubmitButton>
                </ActionForm>
              )}
            </div>
          ) : !two?.hasPassword ? (
            <p className="text-sm text-muted">You sign in through your organisation&apos;s account, which looks after the second step.</p>
          ) : (
            <form action={startTwoStep} className="space-y-3">
              <p className="text-sm"><Badge tone="neutral">Off</Badge> <span className="ml-1">A stolen password is then not enough to get in: signing in also asks for a code from an app on your phone.</span></p>
              <SubmitButton>Set up two-step sign-in</SubmitButton>
            </form>
          )}
        </Panel>
      </div>
    </>
  );
}

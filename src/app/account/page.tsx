import Link from "next/link";
import { PASSWORD_RULE } from "@/lib/auth/password-policy";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Badge, control, Details, Field, Input, PageHeader, Panel } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { twoStepRequiredFor } from "@/lib/auth/two-step";
import { NewBackupCodesForm } from "@/components/two-step-forms";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { changeOwnPassword, newBackupCodeSet, setStartPage, startTwoStep, turnOffTwoStep } from "../login/actions";
import { ROLE_HOME, startPageOptions } from "@/lib/modules";
import { permissionsOf } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const me = await requireUser();
  const [two] = await db.select({ on: users.totpEnabledAt, left: users.backupCodeHashes, hasPassword: users.passwordHash, startPage: users.startPage }).from(users).where(eq(users.id, me.id));
  const pages = startPageOptions(permissionsOf(me.role), me.role);
  const usual = pages.find((p) => p.href === (ROLE_HOME[me.role] ?? "/")) ?? pages[0];
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
            <Field label="New password" hint={PASSWORD_RULE}><Input type="password" name="password" required autoComplete="new-password" /></Field>
            <Field label="New password again"><Input type="password" name="confirm" required autoComplete="new-password" /></Field>
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Panel>
        <Panel title="Start page" className="lg:col-span-2">
          <ActionForm action={setStartPage} className="flex flex-wrap items-end gap-3">
            <Field label="After signing in, open" hint={`The usual page for your role is ${usual.label}.`} className="min-w-64 flex-1 sm:max-w-md">
              <select name="startPage" defaultValue={two?.startPage ?? ""} className={`${control} pr-8`}>
                <option value="">The usual page ({usual.label})</option>
                {[...new Set(pages.map((p) => p.group))].map((g) => (
                  <optgroup key={g} label={g}>{pages.filter((p) => p.group === g).map((p) => <option key={p.href} value={p.href}>{p.label}</option>)}</optgroup>
                ))}
              </select>
            </Field>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </ActionForm>
        </Panel>
        <Panel title="On your phone" className="lg:col-span-2">
          <p className="text-sm">Open PAMS in your phone&apos;s browser and add it to the home screen: on Android, Chrome menu › <em>Add to home screen</em> (or <em>Install app</em>); on iPhone, Safari&apos;s share button › <em>Add to Home Screen</em>. It then opens full screen, with shortcuts to scan a label and report a fault.</p>
          <p className="mt-2 text-sm"><Link href="/scan" className="font-semibold text-primary underline">Scan a label</Link> opens a device&apos;s page from its QR label.</p>
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

import { redirect } from "next/navigation";
import { PASSWORD_RULE } from "@/lib/auth/password-policy";
import { Field, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AuthCard } from "../login/auth-card";
import { createFirstAdmin, needsSetup, setupLocked, setupNeedsCode } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  const askCode = await setupNeedsCode();
  if (await setupLocked()) {
    return (
      <AuthCard title="Create the first administrator" subtitle="One-time setup">
        <p className="text-sm text-muted">Setup is locked on this server until a setup code is set. Add <code>SETUP_CODE=</code> with a code of your choice to the server&apos;s .env file, restart the app, then open this page again.</p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create the first administrator" subtitle="One-time setup">
      <p className="mb-4 text-sm text-muted">This account can add the other users and set approval rules. You can change its details later.</p>
      <ActionForm action={createFirstAdmin} className="space-y-4">
        {askCode && <Field label="Setup code" hint="The SETUP_CODE set in the server's .env file"><Input name="setupCode" required autoComplete="off" /></Field>}
        <Field label="Your name"><Input name="name" required autoComplete="name" /></Field>
        <Field label="Email"><Input type="email" name="email" required autoComplete="username" /></Field>
        <Field label="Password" hint={PASSWORD_RULE}><Input type="password" name="password" required autoComplete="new-password" /></Field>
        <Field label="Password again"><Input type="password" name="confirm" required autoComplete="new-password" /></Field>
        <SubmitButton className="w-full" pendingLabel="Creating…">Create administrator</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}

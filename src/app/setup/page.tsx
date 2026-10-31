import { redirect } from "next/navigation";
import { Field, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AuthCard } from "../login/auth-card";
import { createFirstAdmin, needsSetup, setupNeedsCode } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  const askCode = await setupNeedsCode();
  return (
    <AuthCard title="Create the first administrator" subtitle="One-time setup">
      <p className="mb-4 text-sm text-muted">This account can add the other users and set approval rules. You can change its details later.</p>
      <ActionForm action={createFirstAdmin} className="space-y-4">
        {askCode && <Field label="Setup code" hint="The SETUP_CODE set in the server's .env file"><Input name="setupCode" required autoComplete="off" /></Field>}
        <Field label="Your name"><Input name="name" required autoComplete="name" /></Field>
        <Field label="Email"><Input type="email" name="email" required autoComplete="username" /></Field>
        <Field label="Password" hint="At least 8 characters"><Input type="password" name="password" required autoComplete="new-password" /></Field>
        <Field label="Password again"><Input type="password" name="confirm" required autoComplete="new-password" /></Field>
        <SubmitButton className="w-full" pendingLabel="Creating…">Create administrator</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}

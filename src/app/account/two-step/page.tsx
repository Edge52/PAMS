import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { PageHeader, Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { CodeForm } from "@/components/two-step-forms";
import { TwoStepSetup } from "@/components/two-step-setup";
import { confirmTwoStep } from "@/app/login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up two-step sign-in" };

export default async function TwoStepPage() {
  const me = await requireUser();
  const [u] = await db.select({ secret: users.totpSecret, on: users.totpEnabledAt }).from(users).where(eq(users.id, me.id));
  if (!u?.secret) redirect("/account");
  return (
    <>
      <PageHeader title="Set up two-step sign-in" back={{ href: "/account", label: "Your account" }} />
      <Panel title={u.on ? "Backup codes" : "Three steps"} className="max-w-xl">
        <div>{!u.on && <TwoStepSetup secret={u.secret} email={me.email} />}</div>
        <CodeForm action={confirmTwoStep} submit="Switch on" alreadyOn={!!u.on} />
      </Panel>
    </>
  );
}

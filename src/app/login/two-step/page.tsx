import { redirect } from "next/navigation";
import { currentChallenge } from "@/lib/auth/two-step";
import { CodeForm } from "@/components/two-step-forms";
import { TwoStepSetup } from "@/components/two-step-setup";
import { AuthCard } from "../auth-card";
import { signInEnrol, signInEnrolDone } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up two-step sign-in" };

/** Two-step sign-in is required and this account hasn't set it up yet: do it now, then the sign-in finishes. */
export default async function EnrolPage() {
  const c = await currentChallenge();
  if (!c || c.step !== "ENROL" || !c.user.totpSecret) redirect("/login");
  return (
    <AuthCard title="Set up two-step sign-in" subtitle={c.user.email}>
      {/* Once it's on, the setup steps go and the form (which now shows the backup codes) keeps its place. */}
      <div>{!c.user.totpEnabledAt && <p className="mb-4 text-sm text-muted">Your hospital requires a second step when you sign in: a code from an app on your phone. It takes a minute to set up.</p>}</div>
      <div>{!c.user.totpEnabledAt && <TwoStepSetup secret={c.user.totpSecret} email={c.user.email} />}</div>
      <CodeForm action={signInEnrol} submit="Switch on and sign in" done={signInEnrolDone} alreadyOn={!!c.user.totpEnabledAt} />
    </AuthCard>
  );
}

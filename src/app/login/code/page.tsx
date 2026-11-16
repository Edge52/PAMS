import Link from "next/link";
import { redirect } from "next/navigation";
import { currentChallenge } from "@/lib/auth/two-step";
import { CodeForm } from "@/components/two-step-forms";
import { AuthCard } from "../auth-card";
import { signInCode } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign-in code" };

export default async function CodePage() {
  const c = await currentChallenge();
  if (!c || c.step !== "VERIFY") redirect("/login");
  return (
    <AuthCard title="Enter your code" subtitle={c.user.email}>
      <CodeForm action={signInCode} submit="Sign in" backup />
      <p className="mt-4 text-xs text-muted">Lost your phone and your backup codes? An administrator can reset two-step sign-in for you. <Link href="/login" className="font-semibold text-primary underline">Start again</Link></p>
    </AuthCard>
  );
}

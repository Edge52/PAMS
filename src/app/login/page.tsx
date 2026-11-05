import { redirect } from "next/navigation";
import { and, asc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { getSetting } from "@/lib/settings";
import { AuthCard } from "./auth-card";
import { LoginForm } from "./login-form";
import { needsSetup } from "./actions";
import { safeLocalPath } from "@/lib/safe-path";
import { PROVIDER_LABELS, supabaseConfig } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeLocalPath(next);
  if (await getCurrentUser()) redirect(target && !target.startsWith("/login") ? target : "/");
  if (await needsSetup()) redirect("/setup");
  const demo = (await getSetting("demoAccounts"))
    ? (await db.select({ email: users.email, name: users.name, role: users.role }).from(users)
        .where(and(eq(users.active, true), like(users.email, "%@demo.hpams"))).orderBy(asc(users.id)))
        .map((u) => ({ ...u, role: ROLE_LABELS[u.role as Role] ?? u.role }))
    : [];
  const sso = supabaseConfig();
  return (
    <AuthCard title="Sign in" subtitle="Hospital procurement, BOQ and asset management">
      {error && <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error.slice(0, 300)}</p>}
      {sso && sso.providers.length > 0 && (
        <div className="mb-5 space-y-2">
          {sso.providers.map((p) => (
            <a key={p} href={`/auth/sso/${p}?next=${encodeURIComponent(target ?? "/")}`} className="flex w-full items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">
              Sign in with {PROVIDER_LABELS[p]}
            </a>
          ))}
          <p className="pt-1 text-center text-xs text-zinc-500">or with your PAMS password</p>
        </div>
      )}
      <LoginForm next={target ?? "/"} demo={demo} />
    </AuthCard>
  );
}

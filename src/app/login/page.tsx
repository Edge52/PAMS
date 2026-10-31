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

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeLocalPath(next);
  if (await getCurrentUser()) redirect(target && !target.startsWith("/login") ? target : "/");
  if (await needsSetup()) redirect("/setup");
  const demo = (await getSetting("demoAccounts"))
    ? (await db.select({ email: users.email, name: users.name, role: users.role }).from(users)
        .where(and(eq(users.active, true), like(users.email, "%@demo.hpams"))).orderBy(asc(users.id)))
        .map((u) => ({ ...u, role: ROLE_LABELS[u.role as Role] ?? u.role }))
    : [];
  return (
    <AuthCard title="Sign in" subtitle="Hospital procurement, BOQ and asset management">
      <LoginForm next={target ?? "/"} demo={demo} />
    </AuthCard>
  );
}

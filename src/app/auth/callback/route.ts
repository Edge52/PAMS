/** Finish signing in through Supabase Auth: match the verified email to an active PAMS user (wave 13). */
import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth/session";
import { exchangeCode, supabaseConfig } from "@/lib/auth/supabase";
import { logActivity } from "@/lib/server-utils";

export async function GET(req: Request) {
  const base = process.env.APP_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  const fail = (m: string) => NextResponse.redirect(`${base}/login?error=${encodeURIComponent(m)}`);
  const cfg = supabaseConfig();
  if (!cfg) return fail("Sign-in with Microsoft or Google isn't set up.");
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  if (!code) return fail(u.searchParams.get("error_description") ?? "Sign-in was cancelled.");
  const jar = await cookies();
  let state: { v?: string; n?: string } = {};
  try { state = JSON.parse(jar.get("hpams_pkce")?.value ?? "{}"); } catch { /* missing or damaged */ }
  jar.delete("hpams_pkce");
  if (!state.v) return fail("The sign-in took too long or started in another browser. Try again.");
  const r = await exchangeCode(cfg, code, state.v);
  if ("error" in r) return fail(r.error);
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${r.email}`).limit(1);
  if (!user) return fail(`There's no PAMS account for ${r.email}. Ask an administrator to add you with that email.`);
  if (!user.active) return fail("This account is switched off. Ask an administrator.");
  await createSession(user.id);
  await logActivity("user", user.id, "signed_in", "Signed in with Microsoft or Google (Supabase)", user.name);
  return NextResponse.redirect(`${base}${state.n ?? "/"}`);
}

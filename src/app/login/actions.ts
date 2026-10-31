"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { count, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { ActionState } from "@/lib/procurement/forms";
import { safeLocalPath } from "@/lib/safe-path";

function safeNext(v: FormDataEntryValue | null): string {
  const s = safeLocalPath(v);
  return s && !s.startsWith("/login") ? s : "/";
}

/*
 * Slowing down password guessing, without letting anyone lock others out:
 * - per account: after 5 failures, each further attempt for that email waits (1 s, 2 s, 4 s… up to 30 s) — the
 *   real owner can still sign in, a guesser gets a few attempts a minute;
 * - per client address: 30 failures in 15 minutes blocks that address. The address is the socket's peer as reported
 *   by the proxy only when TRUST_PROXY=1 (then the last X-Forwarded-For hop, the one our proxy added); otherwise
 *   X-Forwarded-For is ignored, since any client can send it.
 * - the table is capped so random emails can't fill memory.
 */
const WINDOW_MS = 15 * 60_000, IP_MAX = 30, EMAIL_FREE = 5, MAX_KEYS = 5000;
const g = globalThis as unknown as { hpamsLoginFails?: Map<string, { n: number; first: number }> };
const fails = (g.hpamsLoginFails ??= new Map());
function failures(key: string) {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() - f.first > WINDOW_MS) { fails.delete(key); return 0; }
  return f.n;
}
function noteFail(key: string) {
  const f = fails.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) {
    if (fails.size >= MAX_KEYS) fails.delete(fails.keys().next().value as string); // oldest first
    fails.set(key, { n: 1, first: Date.now() });
  } else f.n++;
}
async function clientAddress(): Promise<string | null> {
  if (process.env.TRUST_PROXY !== "1") return null;
  const h = await headers();
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return hops.at(-1) ?? h.get("x-real-ip");
}
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signIn(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { errors: ["Enter your email and password."] };
  const ip = await clientAddress();
  const keys = [`e:${email}`, ...(ip ? [`i:${ip}`] : [])];
  if (ip && failures(`i:${ip}`) >= IP_MAX) return { errors: ["Too many failed sign-ins from this network. Wait 15 minutes and try again."] };
  const extra = failures(`e:${email}`) - EMAIL_FREE;
  if (extra >= 0) await wait(Math.min(30_000, 1000 * 2 ** extra));

  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const ok = u ? await verifyPassword(password, u.passwordHash) : await verifyPassword(password, DUMMY_HASH);
  if (!u || !ok) { keys.forEach(noteFail); return { errors: ["That email and password don't match."] }; }
  if (!u.active) return { errors: ["This account is switched off. Ask an administrator."] };
  keys.forEach((k) => fails.delete(k));
  await createSession(u.id);
  await logActivity("user", u.id, "signed_in", "Signed in", u.name);
  redirect(safeNext(fd.get("next")));
}

// Verifying against a fixed hash when the email is unknown keeps response times similar (no account probing).
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/** True until the first administrator with a password exists. */
export async function setupNeedsCode(): Promise<boolean> {
  return !!process.env.SETUP_CODE;
}

export async function needsSetup(): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(users).where(isNotNull(users.passwordHash));
  return (r?.n ?? 0) === 0;
}

const setupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string(),
  confirm: z.string(),
});

export async function createFirstAdmin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await needsSetup())) redirect("/login");
  // On a server, whoever reached /setup first would become administrator; SETUP_CODE (from the server's .env)
  // makes setup need a code only the installer knows.
  const code = process.env.SETUP_CODE;
  if (code && !safeEqual(String(fd.get("setupCode") ?? ""), code)) return { errors: ["That setup code isn't right. It's the SETUP_CODE in the server's .env file."] };
  const p = setupSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { errors: [...new Set(p.error.issues.map((i) => i.message))] };
  const { name, email, password, confirm } = p.data;
  const problem = passwordProblem(password, email);
  if (problem) return { errors: [problem] };
  if (password !== confirm) return { errors: ["The two passwords don't match."] };
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
  let id: number;
  if (existing) {
    await db.update(users).set({ name, role: "ADMIN", active: true, passwordHash }).where(eq(users.id, existing.id));
    id = existing.id;
  } else {
    [{ id }] = await db.insert(users).values({ name, email, role: "ADMIN", passwordHash }).returning({ id: users.id });
  }
  await createSession(id);
  await logActivity("user", id, "created", "First administrator set up", name);
  redirect("/admin/users");
}

export async function changeOwnPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const current = String(fd.get("current") ?? ""), next = String(fd.get("password") ?? ""), confirm = String(fd.get("confirm") ?? "");
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!(await verifyPassword(current, u?.passwordHash))) return { errors: ["Your current password isn't right."] };
  const problem = passwordProblem(next, me.email);
  if (problem) return { errors: [problem] };
  if (next !== confirm) return { errors: ["The two new passwords don't match."] };
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, me.id));
  const { destroyAllSessions } = await import("@/lib/auth/session");
  await destroyAllSessions(me.id, true);
  await logActivity("user", me.id, "password_changed", "Changed their password");
  return { message: "Password changed. You've been signed out on other devices." };
}

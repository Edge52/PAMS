"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { count, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { createSession, destroyAllSessions, destroySession, getCurrentUser } from "@/lib/auth/session";
import { newSecret, verifyCode } from "@/lib/auth/totp";
import { landingPage, startPageOptions } from "@/lib/modules";
import { permissionsOf } from "@/lib/auth/permissions";
import { clearTwoStep, currentChallenge, enableTwoStep, endChallenge, freshBackupCodes, markProved, PROVED, startChallenge, twoStepRequiredFor, spendCode, wrongTry } from "@/lib/auth/two-step";
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
  // Wave 25: with two-step on, the session starts only after the code; when it's required and not set up yet,
  // only after setting it up.
  // Wave 26: the page asked for, else the person's chosen start page, else their role's.
  const next = landingPage(safeNext(fd.get("next")), u.startPage, u.role, permissionsOf(u.role));
  if (u.totpEnabledAt && u.totpSecret) { await startChallenge(u.id, "VERIFY", next); redirect("/login/code"); }
  if (await twoStepRequiredFor(u.role)) {
    if (!u.totpSecret) await db.update(users).set({ totpSecret: newSecret() }).where(eq(users.id, u.id));
    await startChallenge(u.id, "ENROL", next); redirect("/login/two-step");
  }
  await createSession(u.id);
  await logActivity("user", u.id, "signed_in", "Signed in", u.name);
  redirect(next);
}

export type StepState = { error?: string; codes?: string[]; next?: string } | null;

/** Second step of signing in: the 6-digit code from the app, or a backup code. */
export async function signInCode(_prev: StepState, fd: FormData): Promise<StepState> {
  const c = await currentChallenge();
  if (!c || c.step !== "VERIFY") redirect("/login?error=" + encodeURIComponent("That took too long. Sign in again."));
  const how = await spendCode(c.user, String(fd.get("code") ?? ""));
  if (!how) {
    if (await wrongTry(c)) redirect("/login?error=" + encodeURIComponent("Too many wrong codes. Sign in again."));
    return { error: "That code isn't right. Codes change every 30 seconds; check the clock on your phone is right." };
  }
  await endChallenge(c.id);
  await createSession(c.user.id);
  await logActivity("user", c.user.id, "signed_in", how === "backup" ? `Signed in with a backup code (${c.user.backupCodeHashes.length - 1} left)` : "Signed in (two-step)", c.user.name);
  redirect(c.next && c.next.startsWith("/") ? c.next : "/");
}

/** Two-step is required and this account hasn't set it up: prove the first code, then sign in. Shows the backup codes once. */
export async function signInEnrol(_prev: StepState, fd: FormData): Promise<StepState> {
  const c = await currentChallenge();
  if (!c || c.step !== "ENROL" || !c.user.totpSecret || c.user.totpEnabledAt) redirect("/login?error=" + encodeURIComponent("That took too long. Sign in again."));
  const step = verifyCode(c.user.totpSecret, String(fd.get("code") ?? ""), Date.now());
  if (step == null) {
    if (await wrongTry(c)) redirect("/login?error=" + encodeURIComponent("Too many wrong codes. Sign in again."));
    return { error: "That code isn't right. Scan the square again, or check the clock on your phone is right." };
  }
  const codes = await enableTwoStep(c.user.id, step);
  // The session starts when they press Continue (signInEnrolDone), so the backup codes stay on screen until then.
  await markProved(c.id);
  await logActivity("user", c.user.id, "two_step_on", "Switched on two-step sign-in", c.user.name);
  return { codes };
}

/** After the backup codes were shown: finish signing in. Only for a challenge whose first code was just proved. */
export async function signInEnrolDone(): Promise<void> {
  const c = await currentChallenge();
  if (!c || c.step !== "ENROL" || c.attempts !== PROVED || !c.user.totpEnabledAt) redirect("/login?error=" + encodeURIComponent("That took too long. Sign in again."));
  await endChallenge(c.id);
  await createSession(c.user.id);
  await logActivity("user", c.user.id, "signed_in", "Signed in (two-step)", c.user.name);
  redirect(c.next && c.next.startsWith("/") ? c.next : "/");
}

/* ── Two-step sign-in from the account page ── */

export async function startTwoStep(): Promise<void> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const [u] = await db.select({ on: users.totpEnabledAt }).from(users).where(eq(users.id, me.id));
  if (!u?.on) await db.update(users).set({ totpSecret: newSecret(), totpLastStep: null }).where(eq(users.id, me.id));
  redirect("/account/two-step");
}

export async function confirmTwoStep(_prev: StepState, fd: FormData): Promise<StepState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u?.totpSecret || u.totpEnabledAt) redirect("/account");
  const step = verifyCode(u.totpSecret, String(fd.get("code") ?? ""), Date.now());
  if (step == null) return { error: "That code isn't right. Scan the square again, or check the clock on your phone is right." };
  const codes = await enableTwoStep(me.id, step);
  await destroyAllSessions(me.id, true);
  await logActivity("user", me.id, "two_step_on", "Switched on two-step sign-in");
  return { codes, next: "/account" };
}

export async function turnOffTwoStep(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (await twoStepRequiredFor(me.role)) return { errors: ["Two-step sign-in is required for your account, so it can't be switched off."] };
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!(await verifyPassword(String(fd.get("current") ?? ""), u?.passwordHash))) return { errors: ["Your password isn't right."], fields: { current: "Your password isn't right." } };
  await clearTwoStep(me.id);
  await logActivity("user", me.id, "two_step_off", "Switched off two-step sign-in");
  return { message: "Two-step sign-in is off." };
}

export async function newBackupCodeSet(_prev: StepState, fd: FormData): Promise<StepState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u?.totpEnabledAt) redirect("/account");
  if (!(await verifyPassword(String(fd.get("current") ?? ""), u.passwordHash))) return { error: "Your password isn't right." };
  const codes = await freshBackupCodes(me.id);
  await logActivity("user", me.id, "backup_codes", "Made new backup codes");
  return { codes };
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
  await destroyAllSessions(me.id, true);
  await logActivity("user", me.id, "password_changed", "Changed their password");
  return { message: "Password changed. You've been signed out on other devices." };
}

/** Wave 26: the page to open after signing in. Empty = the usual page for your role. */
export async function setStartPage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const want = String(fd.get("startPage") ?? "");
  if (want && !startPageOptions(permissionsOf(me.role), me.role).some((o) => o.href === want)) return { errors: ["Choose a page from the list."] };
  await db.update(users).set({ startPage: want || null }).where(eq(users.id, me.id));
  return { message: want ? "Saved. You'll start there next time you sign in." : "Saved. You'll start on the usual page for your role." };
}


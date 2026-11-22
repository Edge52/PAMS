import "server-only";
/**
 * Two-step sign-in, server side (wave 25). After the right password, a user with two-step on (or who must set it
 * up) gets a short-lived "half signed in" cookie in place of a session; the session starts only after the code.
 */
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginChallenges, sessions, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { newBackupCodes, newSecret, normalBackupCode, verifyCode } from "./totp";
import type { Role } from "./permissions";
import { SESSION_COOKIE } from "./session";
import { canSeal, isSealed, openSecret, sealSecret } from "./secret-box";

export const STEP_COOKIE = "hpams_login_step";
const STEP_MS = 10 * 60_000;
export const MAX_TRIES = 5;
/** After MAX_TRIES wrong codes, signing in again waits this long (S5). */
export const LOCK_MS = 15 * 60_000;
export const LOCKED_MESSAGE = "Too many wrong codes. Wait 15 minutes, then sign in again.";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return (process.env.APP_URL ?? "").startsWith("https://");
}

/** Must this user use two-step sign-in? (Admin › Settings.) */
export async function twoStepRequiredFor(role: Role | string): Promise<boolean> {
  const rule = await getSetting("twoStepRequired");
  return rule === "all" || (rule === "admins" && role === "ADMIN");
}

/**
 * Start the code step. Wrong codes count per user across sign-ins (audit S5): the new challenge carries the
 * count of the one it replaces, and only a right code resets it (the challenge is then deleted). After MAX_TRIES
 * the user's row is kept as a lock for LOCK_MS. Returns false while locked (no challenge, no cookie).
 */
export async function startChallenge(userId: number, step: "VERIFY" | "ENROL", next: string): Promise<boolean> {
  const now = new Date();
  // Housekeeping: drop expired challenges that hold no wrong codes (rows with wrong codes are the counter).
  await db.delete(loginChallenges).where(and(lt(loginChallenges.expiresAt, now), lte(loginChallenges.attempts, 0)));
  const prev = await db.select({ attempts: loginChallenges.attempts, expiresAt: loginChallenges.expiresAt }).from(loginChallenges).where(eq(loginChallenges.userId, userId));
  if (prev.some((r) => r.attempts >= MAX_TRIES && r.expiresAt > now)) return false;
  // After a lock has run out: one more try before the next lock.
  const carried = Math.min(MAX_TRIES - 1, Math.max(0, ...prev.map((r) => r.attempts)));
  const token = randomBytes(32).toString("base64url");
  await db.delete(loginChallenges).where(eq(loginChallenges.userId, userId));
  await db.insert(loginChallenges).values({ tokenHash: sha256(token), userId, step, next, attempts: carried, expiresAt: new Date(Date.now() + STEP_MS) });
  (await cookies()).set(STEP_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/login", maxAge: STEP_MS / 1000 });
  return true;
}

/**
 * After the first factor (the password, or Microsoft/Google sign-in): what comes next. "session" = no code needed,
 * start the session. Otherwise the page of the code step, or "locked" after too many wrong codes (S2: every
 * sign-in path goes through here).
 */
export async function secondStep(u: { id: number; role: Role | string; totpEnabledAt: Date | null; totpSecret: string | null }, next: string): Promise<"session" | "locked" | "/login/code" | "/login/two-step"> {
  if (u.totpEnabledAt && u.totpSecret) return (await startChallenge(u.id, "VERIFY", next)) ? "/login/code" : "locked";
  if (await twoStepRequiredFor(u.role)) {
    if (!u.totpSecret) await db.update(users).set({ totpSecret: sealSecret(newSecret()) }).where(and(eq(users.id, u.id), isNull(users.totpSecret)));
    return (await startChallenge(u.id, "ENROL", next)) ? "/login/two-step" : "locked";
  }
  return "session";
}

export type Challenge = {
  id: number; step: "VERIFY" | "ENROL"; next: string | null; attempts: number;
  user: { id: number; name: string; email: string; totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null; backupCodeHashes: string[] };
};

/** The half-finished sign-in this browser holds, or null (none, or it ran out). */
export async function currentChallenge(): Promise<Challenge | null> {
  const token = (await cookies()).get(STEP_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db.select({
    id: loginChallenges.id, step: loginChallenges.step, next: loginChallenges.next, attempts: loginChallenges.attempts,
    userId: users.id, name: users.name, email: users.email, active: users.active, totpSecret: users.totpSecret,
    totpEnabledAt: users.totpEnabledAt, totpLastStep: users.totpLastStep, backupCodeHashes: users.backupCodeHashes,
  }).from(loginChallenges).innerJoin(users, eq(users.id, loginChallenges.userId))
    .where(and(eq(loginChallenges.tokenHash, sha256(token)), gt(loginChallenges.expiresAt, new Date()))).limit(1);
  if (!row || !row.active) return null;
  return { id: row.id, step: row.step, next: row.next, attempts: row.attempts,
    user: { id: row.userId, name: row.name, email: row.email, totpSecret: row.totpSecret, totpEnabledAt: row.totpEnabledAt, totpLastStep: row.totpLastStep, backupCodeHashes: row.backupCodeHashes } };
}

export async function endChallenge(id: number): Promise<void> {
  await db.delete(loginChallenges).where(eq(loginChallenges.id, id));
  (await cookies()).delete({ name: STEP_COOKIE, path: "/login" });
}

/** Marks an ENROL challenge whose first code was proved: the sign-in may finish without another code. */
export const PROVED = -1;
export async function markProved(id: number): Promise<void> {
  await db.update(loginChallenges).set({ attempts: PROVED }).where(eq(loginChallenges.id, id));
}

/**
 * Use up one try before checking a code, in one statement, so codes sent in parallel can't share a try (S5).
 * Returns the number of this try (1…MAX_TRIES), or null when none is left: the challenge is then locked and its
 * cookie gone.
 */
export async function takeTry(c: Challenge): Promise<number | null> {
  const [r] = await db.update(loginChallenges).set({ attempts: sql`${loginChallenges.attempts} + 1` })
    .where(and(eq(loginChallenges.id, c.id), gte(loginChallenges.attempts, 0), lt(loginChallenges.attempts, MAX_TRIES), gt(loginChallenges.expiresAt, new Date())))
    .returning({ attempts: loginChallenges.attempts });
  if (!r) { await lockChallenge(c.id); return null; }
  return r.attempts;
}

/** The code of try `n` (from takeTry) was wrong: true when that was the last try (then locked for LOCK_MS). */
export async function wrongTry(c: Challenge, n: number): Promise<boolean> {
  if (n < MAX_TRIES) return false;
  await lockChallenge(c.id);
  return true;
}

/** Keep the row as the user's lock: no cookie can match it, it holds MAX_TRIES and runs out after LOCK_MS. */
async function lockChallenge(id: number): Promise<void> {
  await db.update(loginChallenges).set({ tokenHash: sha256(randomBytes(32).toString("base64url")), attempts: MAX_TRIES, expiresAt: new Date(Date.now() + LOCK_MS) })
    .where(eq(loginChallenges.id, id));
  (await cookies()).delete({ name: STEP_COOKIE, path: "/login" });
}

/**
 * Two-step sign-in became required (Admin › Settings, S14): end the sessions of the people it now applies to who
 * haven't set it up, so they set it up when they next sign in. The session making the change stays.
 * Returns how many people were signed out.
 */
export async function endSessionsWithoutTwoStep(rule: "off" | "admins" | "all"): Promise<number> {
  if (rule === "off") return 0;
  const mine = (await cookies()).get(SESSION_COOKIE)?.value;
  const keepTokenHash = mine ? sha256(mine) : null;
  const who = await db.select({ id: users.id }).from(users)
    .where(and(isNull(users.totpEnabledAt), rule === "admins" ? eq(users.role, "ADMIN") : undefined));
  if (!who.length) return 0;
  const gone = await db.delete(sessions)
    .where(and(inArray(sessions.userId, who.map((u) => u.id)), keepTokenHash ? ne(sessions.tokenHash, keepTokenHash) : undefined))
    .returning({ userId: sessions.userId });
  return new Set(gone.map((g) => g.userId)).size;
}

/**
 * Check a typed authenticator code, or a backup code, for a user with two-step on. A right code is used up:
 * the step is remembered, a backup code is struck off. Returns what matched, or null.
 */
export async function spendCode(u: { id: number; totpSecret: string | null; totpLastStep: number | null; backupCodeHashes: string[] }, typed: string): Promise<"code" | "backup" | null> {
  const secret = openSecret(u.totpSecret);
  if (!secret) return null;
  const step = verifyCode(secret, typed, Date.now(), u.totpLastStep);
  if (step != null) {
    // An old plain secret is sealed now that APP_SECRET is set (audit S13).
    const reseal = !isSealed(u.totpSecret) && canSeal() ? { totpSecret: sealSecret(secret) } : {};
    await db.update(users).set({ totpLastStep: step, ...reseal }).where(eq(users.id, u.id));
    return "code";
  }
  const h = sha256(normalBackupCode(typed));
  if (normalBackupCode(typed).length === 8 && u.backupCodeHashes.includes(h)) {
    await db.update(users).set({ backupCodeHashes: u.backupCodeHashes.filter((x) => x !== h) }).where(eq(users.id, u.id));
    return "backup";
  }
  return null;
}

/** Switch two-step on for a user whose first code was just proved: fresh backup codes, returned once in clear. */
export async function enableTwoStep(userId: number, step: number): Promise<string[]> {
  const codes = newBackupCodes();
  await db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step, backupCodeHashes: codes.map((c) => sha256(normalBackupCode(c))) }).where(eq(users.id, userId));
  return codes;
}

export async function freshBackupCodes(userId: number): Promise<string[]> {
  const codes = newBackupCodes();
  await db.update(users).set({ backupCodeHashes: codes.map((c) => sha256(normalBackupCode(c))) }).where(eq(users.id, userId));
  return codes;
}

export async function clearTwoStep(userId: number): Promise<void> {
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, backupCodeHashes: [] }).where(eq(users.id, userId));
}

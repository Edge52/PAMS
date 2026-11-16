import "server-only";
/**
 * Two-step sign-in, server side (wave 25). After the right password, a user with two-step on (or who must set it
 * up) gets a short-lived "half signed in" cookie in place of a session; the session starts only after the code.
 */
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { loginChallenges, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { newBackupCodes, normalBackupCode, verifyCode } from "./totp";
import type { Role } from "./permissions";

export const STEP_COOKIE = "hpams_login_step";
const STEP_MS = 10 * 60_000;
export const MAX_TRIES = 5;

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

export async function startChallenge(userId: number, step: "VERIFY" | "ENROL", next: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db.delete(loginChallenges).where(lt(loginChallenges.expiresAt, new Date()));
  await db.delete(loginChallenges).where(eq(loginChallenges.userId, userId));
  await db.insert(loginChallenges).values({ tokenHash: sha256(token), userId, step, next, expiresAt: new Date(Date.now() + STEP_MS) });
  (await cookies()).set(STEP_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/login", maxAge: STEP_MS / 1000 });
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

/** Count a wrong code; true when the tries have run out (the challenge is then gone). */
export async function wrongTry(c: Challenge): Promise<boolean> {
  if (c.attempts + 1 >= MAX_TRIES) { await endChallenge(c.id); return true; }
  await db.update(loginChallenges).set({ attempts: c.attempts + 1 }).where(eq(loginChallenges.id, c.id));
  return false;
}

/**
 * Check a typed authenticator code, or a backup code, for a user with two-step on. A right code is used up:
 * the step is remembered, a backup code is struck off. Returns what matched, or null.
 */
export async function spendCode(u: { id: number; totpSecret: string | null; totpLastStep: number | null; backupCodeHashes: string[] }, typed: string): Promise<"code" | "backup" | null> {
  if (!u.totpSecret) return null;
  const step = verifyCode(u.totpSecret, typed, Date.now(), u.totpLastStep);
  if (step != null) { await db.update(users).set({ totpLastStep: step }).where(eq(users.id, u.id)); return "code"; }
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

import "server-only";
/**
 * Sessions and access checks (the data-access layer for auth).
 *
 * - The cookie holds a random 32-byte token; the database stores only its SHA-256, so a leaked database can't be
 *   replayed as a cookie.
 * - Sessions last 7 days at most and end after 12 hours without activity.
 * - Use `requireUser()` / `requirePermission()` at the top of every page and server action that needs them. Proxy
 *   only does a quick cookie-present check; this is the real one.
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { sessions, userFacilities, users } from "@/db/schema";
import { can, type Permission, type Role } from "./permissions";

export const SESSION_COOKIE = "hpams_session";
const MAX_AGE_MS = 7 * 24 * 3600_000;
const IDLE_MS = 12 * 3600_000;
const TOUCH_EVERY_MS = 5 * 60_000;

export type CurrentUser = {
  id: number; name: string; email: string; role: Role; jobTitle: string | null; allFacilities: boolean;
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt, userAgent: ua });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  // Housekeeping: drop this user's dead sessions.
  await db.delete(sessions).where(and(eq(sessions.userId, userId),
    or(lt(sessions.expiresAt, new Date()), lt(sessions.lastSeenAt, new Date(Date.now() - IDLE_MS)))));
  // A browser-session cookie (no expiry date): closing the browser signs out, which matters on shared ward PCs.
  // The server still ends the session after 12 idle hours or 7 days at most.
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/" });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Sign a user out everywhere (after a password change or deactivation). */
export async function destroyAllSessions(userId: number, exceptCurrent = false): Promise<void> {
  if (!exceptCurrent) { await db.delete(sessions).where(eq(sessions.userId, userId)); return; }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const keep = token ? sha256(token) : "";
  const all = await db.select({ id: sessions.id, h: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, userId));
  for (const s of all) if (s.h !== keep) await db.delete(sessions).where(eq(sessions.id, s.id));
}

/** The signed-in user, or null. Memoised per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  let token: string | undefined;
  try { token = (await cookies()).get(SESSION_COOKIE)?.value; } catch { return null; } // outside a request (scripts)
  if (!token) return null;
  const now = new Date();
  const [row] = await db.select({
    sid: sessions.id, lastSeenAt: sessions.lastSeenAt,
    id: users.id, name: users.name, email: users.email, role: users.role, jobTitle: users.jobTitle,
    allFacilities: users.allFacilities, active: users.active,
  }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now))).limit(1);
  if (!row || !row.active) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > IDLE_MS) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sid));
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role, jobTitle: row.jobTitle, allFacilities: row.allFacilities };
});

/** Signed-in user or a redirect to the sign-in page. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** Signed-in user holding `permission`, or a redirect (sign-in, or the "no access" page). */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const u = await requireUser();
  if (!can(u.role, permission)) redirect(`/forbidden?need=${encodeURIComponent(permission)}`);
  return u;
}

/** Facilities this user may see: null = all of them. */
export const facilityScope = cache(async (user?: CurrentUser | null): Promise<number[] | null> => {
  const u = user ?? (await getCurrentUser());
  if (!u) return [];
  if (u.role === "ADMIN" || u.allFacilities) return null;
  const rows = await db.select({ id: userFacilities.facilityId }).from(userFacilities).where(eq(userFacilities.userId, u.id));
  return rows.map((r) => r.id);
});

/** Throws a redirect unless the user may see this facility. Pass null/undefined for records without a facility. */
export async function requireFacilityAccess(facilityId: number | null | undefined, user?: CurrentUser): Promise<void> {
  if (facilityId == null) return;
  const scope = await facilityScope(user ?? (await requireUser()));
  if (scope && !scope.includes(facilityId)) redirect("/forbidden?need=facility");
}

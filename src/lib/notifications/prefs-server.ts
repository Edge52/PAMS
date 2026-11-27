import "server-only";
/**
 * Wave 41: loads people's notification choices for the notifications seam and the settings pages. Rules in ./prefs.
 * Works before the wave 41 migration has run (missing tables = everyone on the defaults), so sending a notification
 * never fails because of a choice that can't be read.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationDigests, notificationPrefs, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { delivery, effectiveChannel, type Channel, type Delivery, type RoleDefaults } from "./prefs";

/** Postgres "relation does not exist" (the migration hasn't run yet). */
export function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "42P01";
}

export async function roleDefaults(): Promise<RoleDefaults> {
  try {
    const v = await getSetting("notificationRoleDefaults");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const FALLBACK: Delivery = { store: true, inbox: true, emailNow: true, digest: false };

/** How each user gets a notification of `kind`. */
export async function deliveriesFor(userIds: number[], kind: string): Promise<Map<number, Delivery>> {
  const out = new Map<number, Delivery>(userIds.map((id) => [id, FALLBACK]));
  if (!userIds.length) return out;
  try {
    const [defaults, roles, own, digests] = await Promise.all([
      roleDefaults(),
      db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, userIds)),
      db.select({ userId: notificationPrefs.userId, channel: notificationPrefs.channel }).from(notificationPrefs)
        .where(and(inArray(notificationPrefs.userId, userIds), eq(notificationPrefs.kind, kind))),
      db.select({ userId: notificationDigests.userId, enabled: notificationDigests.enabled }).from(notificationDigests)
        .where(inArray(notificationDigests.userId, userIds)),
    ]);
    const ownBy = new Map(own.map((r) => [r.userId, r.channel]));
    const digestBy = new Map(digests.map((r) => [r.userId, r.enabled]));
    for (const u of roles) {
      out.set(u.id, delivery(kind, effectiveChannel(kind, ownBy.get(u.id), u.role, defaults), digestBy.get(u.id) ?? false));
    }
  } catch (e) {
    if (!isMissingTable(e)) console.error("[notifications] choices not read, using defaults:", e instanceof Error ? e.message : e);
  }
  return out;
}

export type MyPrefs = { channels: Record<string, Channel | null>; digest: { enabled: boolean; hour: number; lastSentOn: string | null } };

/** One person's own choices (null = the role default). */
export async function prefsOf(userId: number): Promise<MyPrefs> {
  const rows = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(500);
  const [d] = await db.select().from(notificationDigests).where(eq(notificationDigests.userId, userId));
  return {
    channels: Object.fromEntries(rows.map((r) => [r.kind, r.channel as Channel])),
    digest: { enabled: d?.enabled ?? false, hour: d?.hour ?? 7, lastSentOn: d?.lastSentOn ?? null },
  };
}

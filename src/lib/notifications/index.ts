import "server-only";
/**
 * Notification seam. OWNED BY: notifications agent.
 * Contract other modules rely on — keep these signatures:
 *   notifyUsers(userIds, n)            one notification per user (deduped per user by n.dedupeKey when given)
 *   notifyRole(role, n, facilityId?)   every active user with that role (limited to users who can see facilityId)
 *   usersWithRole(role, facilityId?)   the user ids notifyRole would reach
 *
 * New notifications are emailed afterwards when email is switched on (see ./email). Email never delays or breaks
 * the caller: it runs after the insert, unawaited, and logs its own failures.
 *
 * Wave 41: each person's choice per kind (./prefs) decides whether it is stored, counted in the inbox, emailed now or
 * left for the daily digest. Safety-critical kinds also go out by SMS/WhatsApp when NOTIFY_WEBHOOK_URL is set.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, userFacilities, users } from "@/db/schema";
import type { Role } from "@/lib/auth/permissions";
import { emailNotifications } from "./email";
import { isSafetyKind } from "./prefs";
import { deliveriesFor } from "./prefs-server";
import { absoluteLink, safeHref, type NewNotification } from "./types";
import { configuredSender, sendMessages } from "./webhook";

export type { NewNotification } from "./types";

export async function notifyUsers(userIds: number[], n: NewNotification): Promise<number> {
  const ids = [...new Set(userIds)].filter((x) => Number.isInteger(x));
  if (ids.length === 0) return 0;
  const how = await deliveriesFor(ids, n.kind);
  const keep = ids.filter((id) => how.get(id)?.store !== false);
  if (keep.length === 0) return 0;
  const now = new Date();
  const res = await db.insert(notifications)
    .values(keep.map((userId) => ({
      userId, kind: n.kind, title: n.title.slice(0, 500), body: n.body ?? null, href: n.href ?? null,
      dedupeKey: n.dedupeKey ? n.dedupeKey.slice(0, 160) : null,
      // "Email only": kept in the inbox, already read.
      readAt: how.get(userId)?.inbox === false ? now : null,
    })))
    .onConflictDoNothing().returning({ id: notifications.id, userId: notifications.userId });
  const emailNow = res.filter((r) => how.get(r.userId)?.emailNow !== false).map((r) => r.id);
  if (emailNow.length) void emailNotifications(emailNow);
  if (res.length && isSafetyKind(n.kind)) void textMessages(res.map((r) => r.userId), n);
  return res.length;
}

/** SMS/WhatsApp for safety-critical notifications (only when a webhook is set up). */
export async function textMessages(userIds: number[], n: NewNotification): Promise<number> {
  try {
    const sender = configuredSender();
    if (!sender || !userIds.length) return 0;
    const people = await db.select({ name: users.name, phone: users.phone }).from(users)
      .where(and(inArray(users.id, userIds), eq(users.active, true)));
    const link = safeHref(n.href) ? absoluteLink(process.env.APP_URL?.trim(), n.href) : null;
    return await sendMessages(sender, people, { kind: n.kind, title: n.title, link });
  } catch (e) {
    console.error("[notifications] text messages failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Active users holding `role`; when facilityId is given, only those who can see it. */
export async function usersWithRole(role: Role, facilityId?: number | null): Promise<number[]> {
  const rows = await db.select({ id: users.id, all: users.allFacilities, role: users.role }).from(users)
    .where(and(eq(users.role, role), eq(users.active, true)));
  if (facilityId == null) return rows.map((r) => r.id);
  const limited = rows.filter((r) => !r.all && r.role !== "ADMIN").map((r) => r.id);
  const allowed = limited.length
    ? new Set((await db.select({ u: userFacilities.userId }).from(userFacilities)
        .where(and(inArray(userFacilities.userId, limited), eq(userFacilities.facilityId, facilityId)))).map((r) => r.u))
    : new Set<number>();
  return rows.filter((r) => r.all || r.role === "ADMIN" || allowed.has(r.id)).map((r) => r.id);
}

export async function notifyRole(role: Role, n: NewNotification, facilityId?: number | null): Promise<number> {
  return notifyUsers(await usersWithRole(role, facilityId), n);
}

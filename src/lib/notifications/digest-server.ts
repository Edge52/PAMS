import "server-only";
/**
 * Wave 41: the daily digest. Runs with the hourly alert job; for each person whose digest hour (Cairo time) has come
 * and who hasn't had one today, sends one email listing the notifications left for it, grouped by kind with links,
 * and marks them emailed. Rules in ./prefs (digestDue, groupDigest, digestEmail).
 */
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notificationDigests, notificationPrefs, notifications, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { todayISO } from "@/lib/format";
import { mailConfig, sendMail } from "./email";
import { delivery, digestDue, digestEmail, effectiveChannel, groupDigest } from "./prefs";
import { isMissingTable, roleDefaults } from "./prefs-server";

const LOOKBACK_MS = 48 * 3600_000;
const MAX_ITEMS = 200;

export async function runDigests(now = new Date()): Promise<number> {
  try {
    const cfg = mailConfig();
    if (!cfg || !(await getSetting("emailEnabled"))) return 0;
    const rows = await db.select({ d: notificationDigests, email: users.email, role: users.role }).from(notificationDigests)
      .innerJoin(users, eq(users.id, notificationDigests.userId))
      .where(and(eq(notificationDigests.enabled, true), eq(users.active, true))).limit(2000);
    const due = rows.filter((r) => digestDue({ enabled: r.d.enabled, hour: r.d.hour, lastSentOn: r.d.lastSentOn }, now));
    if (!due.length) return 0;
    const defaults = await roleDefaults();
    const today = todayISO(now);
    let sent = 0;
    for (const r of due) {
      const since = r.d.lastSentAt && now.getTime() - r.d.lastSentAt.getTime() < LOOKBACK_MS ? r.d.lastSentAt : new Date(now.getTime() - LOOKBACK_MS);
      const [items, own] = await Promise.all([
        db.select().from(notifications).where(and(eq(notifications.userId, r.d.userId), isNull(notifications.emailedAt), gt(notifications.createdAt, since)))
          .orderBy(notifications.createdAt).limit(MAX_ITEMS),
        db.select({ kind: notificationPrefs.kind, channel: notificationPrefs.channel }).from(notificationPrefs).where(eq(notificationPrefs.userId, r.d.userId)).limit(500),
      ]);
      const ownBy = new Map(own.map((o) => [o.kind, o.channel]));
      const picked = items.filter((i) => delivery(i.kind, effectiveChannel(i.kind, ownBy.get(i.kind), r.role, defaults), true).digest);
      if (picked.length && r.email) {
        try {
          const m = digestEmail(groupDigest(picked), cfg.appUrl, today);
          await sendMail(r.email, m.subject, m.text);
          await db.update(notifications).set({ emailedAt: now }).where(inArray(notifications.id, picked.map((p) => p.id)));
          sent++;
        } catch (e) {
          console.error(`[digest] email to ${r.email} failed:`, e instanceof Error ? e.message : e);
          continue; // try again next hour
        }
      }
      await db.update(notificationDigests).set({ lastSentOn: today, lastSentAt: now }).where(eq(notificationDigests.userId, r.d.userId));
    }
    return sent;
  } catch (e) {
    if (!isMissingTable(e)) console.error("[digest] run failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

import "server-only";
/** Reads and read-state changes for one user's inbox. Every function is scoped by userId — never by id alone. */
import { and, count, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";

export const INBOX_PAGE = 50;

export async function unreadCount(userId: number): Promise<number> {
  const [r] = await db.select({ n: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function inboxCounts(userId: number): Promise<{ all: number; unread: number }> {
  const [r] = await db.select({
    all: count(),
    unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
  }).from(notifications).where(eq(notifications.userId, userId));
  return { all: r?.all ?? 0, unread: Number(r?.unread ?? 0) };
}

/** Newest first. `before` = id cursor for "show older". */
export async function listInbox(userId: number, opts: { unreadOnly?: boolean; before?: number; limit?: number } = {}) {
  const conds: (SQL | undefined)[] = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  if (opts.before) conds.push(lt(notifications.id, opts.before));
  return db.select().from(notifications).where(and(...conds))
    .orderBy(desc(notifications.id)).limit(opts.limit ?? INBOX_PAGE);
}

/** Mark one of this user's notifications read; returns its href (found=false if it isn't theirs or doesn't exist). */
export async function markRead(userId: number, id: number): Promise<{ found: boolean; href: string | null }> {
  const [row] = await db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ href: notifications.href });
  return row ? { found: true, href: row.href } : { found: false, href: null };
}

export async function markUnread(userId: number, id: number): Promise<boolean> {
  const res = await db.update(notifications).set({ readAt: null })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId))).returning({ id: notifications.id });
  return res.length > 0;
}

export async function markAllRead(userId: number): Promise<number> {
  const res = await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))).returning({ id: notifications.id });
  return res.length;
}

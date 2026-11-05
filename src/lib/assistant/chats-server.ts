import "server-only";
/** Saved assistant chats (wave 14): each person sees and keeps only their own. */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assistantChats } from "@/db/schema";
import { chatTitle } from "./answer-format";
import type { ChatTurn } from "./defs";

/** Chats kept per person; older ones are removed when a new one is saved. */
export const KEEP_CHATS = 50;

export async function listChats(userId: number, limit = KEEP_CHATS) {
  return db.select({ id: assistantChats.id, title: assistantChats.title, updatedAt: assistantChats.updatedAt })
    .from(assistantChats).where(eq(assistantChats.userId, userId)).orderBy(desc(assistantChats.updatedAt)).limit(limit);
}

export async function getChat(id: number, userId: number) {
  const [c] = await db.select().from(assistantChats).where(and(eq(assistantChats.id, id), eq(assistantChats.userId, userId)));
  return c ?? null;
}

/** Save the conversation: a new chat, or the given one when it is this person's. Returns its id. */
export async function saveChat(userId: number, chatId: number | null, turns: ChatTurn[]): Promise<number> {
  const clean = turns.map((t) => ({ role: t.role, text: t.text.slice(0, 20_000) })).slice(-60);
  const first = clean.find((t) => t.role === "user")?.text ?? "Chat";
  if (chatId) {
    const [row] = await db.update(assistantChats).set({ turns: clean }).where(and(eq(assistantChats.id, chatId), eq(assistantChats.userId, userId))).returning({ id: assistantChats.id });
    if (row) return row.id;
  }
  const [row] = await db.insert(assistantChats).values({ userId, title: chatTitle(first), turns: clean }).returning({ id: assistantChats.id });
  const old = (await db.select({ id: assistantChats.id }).from(assistantChats).where(eq(assistantChats.userId, userId)).orderBy(desc(assistantChats.updatedAt)).offset(KEEP_CHATS));
  for (const o of old) await db.delete(assistantChats).where(eq(assistantChats.id, o.id));
  return row.id;
}

export async function deleteChat(id: number, userId: number): Promise<boolean> {
  const r = await db.delete(assistantChats).where(and(eq(assistantChats.id, id), eq(assistantChats.userId, userId))).returning({ id: assistantChats.id });
  return r.length > 0;
}

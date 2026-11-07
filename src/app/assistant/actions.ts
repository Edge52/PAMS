"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ask } from "@/lib/assistant/run";
import type { ChatTurn } from "@/lib/assistant/defs";
import { deleteChat, saveChat } from "@/lib/assistant/chats-server";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/server-utils";

export async function askAction(history: ChatTurn[], chatId: number | null = null): Promise<{ text: string; used: string[]; chatId: number | null } | { error: string }> {
  const me = await requireUser();
  const s = await getSettings();
  if (!s.assistantEnabled) return { error: "The assistant is switched off. An administrator can switch it on in settings." };
  if (!Array.isArray(history)) return { error: "Ask a question first." };
  const clean = history.filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string").map((t) => ({ role: t.role, text: t.text }));
  const r = await ask(me, clean, s.assistantModel);
  // The audit trail records who used it and which look-ups ran, not what was asked.
  await logActivity("assistant", me.id, "asked", "error" in r ? `Assistant: ${r.error}` : `Assistant answered${r.used.length ? ` (looked up: ${[...new Set(r.used)].join(", ")})` : ""}`, me.name);
  if ("error" in r) return r;
  // Kept for the person who asked (wave 14): only they can open it again.
  const id = await saveChat(me.id, Number.isInteger(chatId) && chatId! > 0 ? chatId : null, [...clean, { role: "assistant", text: r.text }]).catch(() => null);
  revalidatePath("/assistant");
  return { ...r, chatId: id };
}

export async function deleteChatAction(fd: FormData) {
  const me = await requireUser();
  const id = Number(fd.get("chatId"));
  if (Number.isInteger(id) && id > 0) await deleteChat(id, me.id);
  revalidatePath("/assistant");
  redirect("/assistant");
}

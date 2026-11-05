"use server";
import { requireUser } from "@/lib/auth/session";
import { ask } from "@/lib/assistant/run";
import type { ChatTurn } from "@/lib/assistant/defs";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/server-utils";

export async function askAction(history: ChatTurn[]): Promise<{ text: string; used: string[] } | { error: string }> {
  const me = await requireUser();
  const s = await getSettings();
  if (!s.assistantEnabled) return { error: "The assistant is switched off. An administrator can switch it on in settings." };
  if (!Array.isArray(history)) return { error: "Ask a question first." };
  const clean = history.filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string").map((t) => ({ role: t.role, text: t.text }));
  const r = await ask(me, clean, s.assistantModel);
  // The audit trail records who used it and which look-ups ran, not what was asked.
  await logActivity("assistant", me.id, "asked", "error" in r ? `Assistant: ${r.error}` : `Assistant answered${r.used.length ? ` (looked up: ${[...new Set(r.used)].join(", ")})` : ""}`, me.name);
  return r;
}

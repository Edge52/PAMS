import "server-only";
/**
 * The assistant's conversation loop (wave 13): sends the chat and the user's tools to Claude, runs the tools it asks
 * for, and returns the answer. Only runs when an administrator has switched it on and ANTHROPIC_API_KEY is set.
 */
import type { CurrentUser } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { clip, toolsFor, trimHistory, type ChatTurn } from "./defs";
import { runTool } from "./tools";

const API = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, "") || "https://api.anthropic.com";
const MAX_ROUNDS = 8;

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string | unknown[] };

function system(me: CurrentUser) {
  return `You are the assistant inside Hospital PAMS, a system for hospital equipment planning (BOQs), procurement under Egyptian Law 182/2018, and medical device management.
You are helping ${me.name}, ${ROLE_LABELS[me.role as Role] ?? me.role}${me.jobTitle ? ` (${me.jobTitle})` : ""}. Today is ${new Date().toISOString().slice(0, 10)}.

- Answer from PAMS data (devices, work orders, service contracts, recalls, BOQs, projects, suppliers, purchase orders, budgets): use the tools to look things up, and never make up tags, numbers, prices, dates or names. If the tools don't have it, say so.
- The tools only show what this user may see. You can't change anything in PAMS; tell the user where to do it instead.
- When you mention a record that has a link, give it as a path such as /assets/12 so the user can open it.
- You can draft technical specifications (use the device type's parameters and say which values the hospital must confirm), letters to suppliers, memos and reports. Mark anything you assumed in [square brackets].
- Write plainly and briefly in English. Use short headings and lists where they help. Amounts with their currency.
- For a table, use Markdown table rows (| a | b |). The user can download any answer as a Word document, so drafts should be complete and ready to edit.`;
}

export async function ask(me: CurrentUser, history: ChatTurn[], model: string): Promise<{ text: string; used: string[] } | { error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "The assistant needs ANTHROPIC_API_KEY set on the server." };
  const tools = toolsFor(me.role).map(({ need: _n, ...t }) => (void _n, t));
  const messages: Msg[] = trimHistory(history).map((t) => ({ role: t.role, content: t.text }));
  if (!messages.length) return { error: "Ask a question first." };
  const used: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(`${API}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, system: system(me), tools, messages }),
      signal: AbortSignal.timeout(90_000),
    }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }) as const);
    const body = (await res.json().catch(() => ({}))) as { content?: Block[]; stop_reason?: string; error?: { message?: string } };
    if (!res.ok) return { error: res.status === 401 ? "The API key was refused. Check ANTHROPIC_API_KEY." : `The assistant couldn't answer (${body.error?.message ?? `error ${res.status}`}).` };
    const content = body.content ?? [];
    const calls = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    const text = content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
    if (body.stop_reason !== "tool_use" || !calls.length) return { text: text || "(No answer.)", used };
    messages.push({ role: "assistant", content });
    const results = [];
    for (const c of calls) {
      used.push(c.name);
      let out: unknown;
      try { out = await runTool(me, c.name, c.input ?? {}); } catch { out = { error: "That look-up failed." }; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: clip(out), ...(out && typeof out === "object" && "error" in out ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: "That needed too many look-ups. Try a narrower question.", used };
}

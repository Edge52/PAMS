import { getCurrentUser } from "@/lib/auth/session";
import { fileSlug, parseAnswer, type Block } from "@/lib/assistant/answer-format";
import { getChat } from "@/lib/assistant/chats-server";
import { docx } from "@/lib/docx";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * A saved chat as a Word file (wave 14): one answer (?turn=<index>), or the whole conversation. Only the person who
 * had the chat can download it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const id = Number((await params).chatId);
  const chat = Number.isInteger(id) && id > 0 ? await getChat(id, me.id) : null;
  if (!chat) return new Response("That chat isn't there.", { status: 404 });
  const turnParam = new URL(req.url).searchParams.get("turn");
  const footer = `Drafted with the Hospital PAMS assistant on ${formatDate(new Date())}. Check facts and figures before relying on them; items in [square brackets] were assumed.`;
  let title: string, blocks: Block[];
  if (turnParam != null) {
    const i = Number(turnParam), t = chat.turns[i];
    if (!Number.isInteger(i) || !t || t.role !== "assistant") return new Response("That answer isn't there.", { status: 404 });
    const question = [...chat.turns.slice(0, i)].reverse().find((x) => x.role === "user")?.text ?? chat.title;
    const parsed = parseAnswer(t.text);
    // An answer that opens with its own heading keeps it as the title.
    if (parsed[0]?.type === "h") { title = parsed[0].text; blocks = parsed.slice(1); } else { title = question.length > 120 ? `${question.slice(0, 117)}…` : question; blocks = parsed; }
  } else {
    title = chat.title;
    blocks = chat.turns.flatMap((t): Block[] => t.role === "user"
      ? [{ type: "h", level: 2, text: `Question: ${t.text.replace(/\s+/g, " ").slice(0, 300)}` }]
      : [...parseAnswer(t.text), { type: "gap" }]);
  }
  const file = docx({ title, subtitle: `Hospital PAMS · ${me.name} · ${formatDate(new Date())}`, blocks, footer });
  return new Response(new Uint8Array(file), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${fileSlug(title)}.docx"`,
      "cache-control": "no-store",
    },
  });
}

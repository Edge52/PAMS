"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Textarea } from "@/components/ui";
import type { ChatTurn } from "@/lib/assistant/defs";
import { parseAnswer, runs } from "@/lib/assistant/answer-format";
import { askAction } from "./actions";

const PAGES = "(?:assets|procurement|facilities|boq|flows|catalogue|reports)(?:\\/[\\w-]+)*";
const PATH = new RegExp(`((?<![\\w/])\\/${PAGES})`, "g"), IS_PATH = new RegExp(`^\\/${PAGES}$`);

/** Bold, inline code and PAMS paths (/assets/12) as links. */
function inline(s: string): ReactNode[] {
  return runs(s).map((r, i) => {
    if (r.code) return <code key={i} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{r.text}</code>;
    const parts = r.text.split(PATH).map((p, j) => IS_PATH.test(p) ? <Link key={j} href={p} className="text-primary hover:underline">{p}</Link> : <Fragment key={j}>{p}</Fragment>);
    return r.bold ? <b key={i}>{parts}</b> : <Fragment key={i}>{parts}</Fragment>;
  });
}

function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {parseAnswer(text).map((b, i) => {
        switch (b.type) {
          case "h": return <p key={i} className="pt-1 font-bold">{inline(b.text)}</p>;
          case "li": return <p key={i} className="-indent-3" style={{ paddingLeft: `${1 + b.depth}rem` }}>{b.n != null ? `${b.n}.` : "•"} {inline(b.text)}</p>;
          case "p": return <p key={i}>{inline(b.text)}</p>;
          case "gap": return <div key={i} className="h-1" />;
          case "table": return (
            <div key={i} className="overflow-x-auto">
              <table className="my-1 text-xs">
                <thead><tr>{b.rows[0].map((c, j) => <th key={j} className="border border-line bg-sunken px-2 py-1 text-left">{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border border-line px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
      })}
    </div>
  );
}

export function Chat({ hints, chatId: savedId = null, initialTurns = [] }: { hints: string[]; chatId?: number | null; initialTurns?: ChatTurn[] }) {
  const router = useRouter();
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [chatId, setChatId] = useState<number | null>(savedId);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  const send = (q: string) => {
    if (!q.trim() || pending) return;
    const next = [...turns, { role: "user" as const, text: q.trim() }];
    setTurns(next); setDraft(""); setError(null);
    start(async () => {
      const r = await askAction(next, chatId);
      if ("error" in r) { setError(r.error); setTurns(next.slice(0, -1)); setDraft(q); return; }
      setTurns([...next, { role: "assistant", text: r.text }]);
      // A new chat now has an address, so it can be reopened from the list (and the page shows it there).
      if (r.chatId && r.chatId !== chatId) { setChatId(r.chatId); router.replace(`/assistant?chat=${r.chatId}`, { scroll: false }); }
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    });
  };
  const copy = (i: number, t: string) => { void navigator.clipboard?.writeText(t).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500); }); };

  return (
    <div className="space-y-4">
      {!turns.length && hints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hints.map((h) => <button key={h} type="button" onClick={() => send(h)} className="rounded-full border border-line px-3 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">{h}</button>)}
        </div>
      )}
      {turns.map((t, i) => t.role === "user"
        ? <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-[var(--color-primary)]/10 px-3 py-2 text-sm">{t.text}</div>
        : (
          <div key={i} className="rounded-lg border border-line bg-surface px-4 py-3">
            <Answer text={t.text} />
            <div className="mt-2 flex justify-end gap-3 text-xs">
              {chatId && <a href={`/assistant/${chatId}/download?turn=${i}`} download className="text-muted hover:underline">Download as Word</a>}
              <button type="button" onClick={() => copy(i, t.text)} className="text-muted hover:underline">{copied === i ? "Copied" : "Copy"}</button>
            </div>
          </div>
        ))}
      {pending && <p className="text-sm text-muted" role="status">Looking it up…</p>}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="space-y-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={4000} placeholder="Ask a question, or say what to draft…" aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">Answers can be wrong: check figures before you rely on them. Chats are kept for you only.</p>
          <div className="flex gap-2">
            {chatId && turns.length > 1 && <a href={`/assistant/${chatId}/download`} download className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas">Download chat</a>}
            {turns.length > 0 && <Button type="button" variant="secondary" onClick={() => router.push("/assistant")} disabled={pending}>New chat</Button>}
            <Button type="submit" disabled={pending || !draft.trim()}>Ask</Button>
          </div>
        </div>
      </form>
      <div ref={end} />
    </div>
  );
}

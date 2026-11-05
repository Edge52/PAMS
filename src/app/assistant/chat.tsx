"use client";
import Link from "next/link";
import { Fragment, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Textarea } from "@/components/ui";
import type { ChatTurn } from "@/lib/assistant/defs";
import { askAction } from "./actions";

/** Bold, inline code and PAMS paths (/assets/12) as links. */
function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![\w/])\/(?:assets|procurement|facilities|boq|flows|catalogue|reports)(?:\/[\w-]+)*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <b key={i}>{p.slice(2, -2)}</b>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i} className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{p.slice(1, -1)}</code>;
    if (p.startsWith("/")) return <Link key={i} href={p} className="text-primary hover:underline">{p}</Link>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Answer({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split("\n").map((line, i) => {
        const h = /^(#{1,4})\s+(.*)$/.exec(line), li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (h) return <p key={i} className="pt-1 font-bold">{inline(h[2])}</p>;
        if (li) return <p key={i} className="pl-4 -indent-3">• {inline(li[1])}</p>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{inline(line)}</p>;
      })}
    </div>
  );
}

export function Chat({ hints }: { hints: string[] }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
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
      const r = await askAction(next);
      if ("error" in r) { setError(r.error); setTurns(next.slice(0, -1)); setDraft(q); return; }
      setTurns([...next, { role: "assistant", text: r.text }]);
      requestAnimationFrame(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    });
  };
  const copy = (i: number, t: string) => { void navigator.clipboard?.writeText(t).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1500); }); };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
            <div className="mt-2 text-right"><button type="button" onClick={() => copy(i, t.text)} className="text-xs text-muted hover:underline">{copied === i ? "Copied" : "Copy"}</button></div>
          </div>
        ))}
      {pending && <p className="text-sm text-muted" role="status">Looking it up…</p>}
      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="space-y-2">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={4000} placeholder="Ask a question, or say what to draft…" aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Answers can be wrong: check figures before you rely on them.</p>
          <div className="flex gap-2">
            {turns.length > 0 && <Button type="button" variant="secondary" onClick={() => { setTurns([]); setError(null); }} disabled={pending}>New chat</Button>}
            <Button type="submit" disabled={pending || !draft.trim()}>Ask</Button>
          </div>
        </div>
      </form>
      <div ref={end} />
    </div>
  );
}

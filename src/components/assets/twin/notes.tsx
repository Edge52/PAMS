"use client";
/**
 * Notes in the 3D model (wave 7, step 7e): the composer shown for a selected room or device (or a picked spot), and the
 * list of notes in the Notes panel. The view owns the state; these only render and call back.
 */
import Link from "next/link";
import { useState } from "react";
import type { TwinNote } from "@/lib/assets/twin-notes";

export function NoteComposer({ where, people, busy, onSave, onCancel }: {
  where: string; people: { id: number; name: string }[]; busy: boolean;
  onSave: (text: string, assigneeId: number | null) => void; onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [who, setWho] = useState("");
  return (
    <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave(text.trim(), who ? Number(who) : null); }}>
      <p className="text-xs text-[#8fb6cc]">Note on {where}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} required aria-label="Note"
        placeholder="e.g. Socket behind the bed is loose; check before the new monitor goes in" className="twin-input" />
      <label className="flex items-center gap-2 text-xs text-[#8fb6cc]">For
        <select value={who} onChange={(e) => setWho(e.target.value)} className="twin-input py-0.5">
          <option value="">Anyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="flex gap-1.5">
        <button type="submit" disabled={busy || !text.trim()} className="twin-act">{busy ? "Saving…" : "Add note"}</button>
        <button type="button" onClick={onCancel} className="twin-act">Cancel</button>
      </div>
    </form>
  );
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export function NoteList({ notes, whereOf, me, canReport, onFocus, onStatus, onDelete, onPhoto }: {
  notes: TwinNote[]; whereOf: (n: TwinNote) => string; me: { id: number; canEditAssets: boolean }; canReport: boolean;
  onFocus: (n: TwinNote) => void; onStatus: (n: TwinNote, done: boolean) => void; onDelete: (n: TwinNote) => void;
  /** Attach a photo (wave 8). */
  onPhoto?: (n: TwinNote, file: File) => void;
}) {
  if (!notes.length) return <p className="text-xs text-[#8fb6cc]">No notes here.</p>;
  return (
    <ul className="space-y-1.5">
      {notes.map((n) => {
        const mayClose = n.byId === me.id || n.assigneeId === me.id || me.canEditAssets;
        return (
          <li key={n.id} className={`rounded border border-[#123a55] px-2 py-1.5 ${n.status === "DONE" ? "opacity-60" : ""}`}>
            <button type="button" onClick={() => onFocus(n)} className="w-full text-left">
              <p className="whitespace-pre-line text-[13px] text-white">{n.text}</p>
              <p className="text-[11px] text-[#8fb6cc]">{whereOf(n)} · {n.byName ?? "Someone"}, {ago(n.at)}{n.assigneeName ? ` · for ${n.assigneeName}` : ""}{n.status === "DONE" ? ` · closed${n.closedByName ? ` by ${n.closedByName}` : ""}` : ""}</p>
            </button>
            {n.photos && n.photos.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {n.photos.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.name}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- an uploaded file served by /files */}
                    <img src={p.url} alt={p.name} className="size-12 rounded border border-[#123a55] object-cover" />
                  </a>
                ))}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              {onPhoto && n.status === "OPEN" && (
                <label className="cursor-pointer text-[#5fd6ff] hover:underline">Add photo
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(n, f); e.target.value = ""; }} />
                </label>
              )}
              {mayClose && <button type="button" onClick={() => onStatus(n, n.status === "OPEN")} className="text-[#5fd6ff] hover:underline">{n.status === "OPEN" ? "Close" : "Reopen"}</button>}
              {n.workOrderId ? <Link href={`/assets/work-orders/${n.workOrderId}`} className="text-[#5fd6ff] hover:underline">Work order</Link>
                : canReport && n.assetId && n.status === "OPEN" && (
                  <Link href={`/assets/work-orders/new?assetId=${n.assetId}&noteId=${n.id}&title=${encodeURIComponent(n.text.split("\n")[0].slice(0, 160))}`} className="text-[#ffb08a] hover:underline">Turn into a work order</Link>
                )}
              {(n.byId === me.id || me.canEditAssets) && <button type="button" onClick={() => onDelete(n)} className="text-[#8fb6cc] hover:text-[#ff8a96]">Delete</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

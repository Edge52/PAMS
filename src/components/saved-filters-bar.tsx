"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icons";
import { cleanQuery, MAX_NAME, savedFilterHref, type SavedFilterKey } from "@/lib/saved-filters";
import { deleteFilterAction, saveFilterAction } from "@/lib/saved-filters-actions";
import type { SavedFilterRow } from "@/lib/saved-filters-server";

/** The chips and the save box of SavedFilters (wave 41). The list is kept on the server. */
export function SavedFiltersBar({ page, initial }: { page: SavedFilterKey; initial: SavedFilterRow[] }) {
  const pathname = usePathname(), sp = useSearchParams();
  const [saved, setSaved] = useState(initial);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [share, setShare] = useState(false);
  const [message, setMessage] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const query = cleanQuery(sp.toString()) ?? "";
  const run = (p: Promise<{ ok?: string; error?: string; list?: SavedFilterRow[] }>, after?: () => void) => start(async () => {
    const r = await p;
    if (r.list) setSaved(r.list);
    setMessage({ ok: r.ok, error: r.error });
    if (!r.error) after?.();
  });
  const save = () => run(saveFilterAction({ page, path: pathname, name, query, share }), () => { setName(""); setShare(false); setNaming(false); });
  if (!query && saved.length === 0) return null;
  const current = saved.some((s) => s.mine && s.path === pathname && s.query === query);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      {saved.length > 0 && <span className="text-muted">Saved filters:</span>}
      {saved.map((s) => {
        const on = s.path === pathname && s.query === query;
        const note = s.mine ? (s.shared ? "Shared with your role" : undefined) : `Shared by ${s.owner ?? "a colleague"}`;
        return (
          <span key={s.id} title={note} className={`inline-flex items-center rounded-full border ${on ? "border-primary bg-primary-soft text-primary-strong" : "border-line bg-surface"}`}>
            <Link href={savedFilterHref(s.path, s.query)} aria-current={on ? "true" : undefined} className={`inline-flex min-h-8 items-center gap-1.5 pl-3 font-semibold ${s.mine ? "pr-1" : "pr-3"}`}>
              <Icon name="bookmark" size={13} />{s.name}{s.shared && <span className="font-normal text-muted">{s.mine ? "(shared)" : `(${s.owner ?? "shared"})`}</span>}
            </Link>
            {s.mine && (
              <button type="button" disabled={pending} onClick={() => run(deleteFilterAction({ page, id: s.id }))} aria-label={`Remove saved filter ${s.name}`}
                className="grid size-8 place-items-center rounded-full text-muted hover:text-danger"><Icon name="close" size={12} /></button>
            )}
          </span>
        );
      })}
      {query && !current && (naming ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`saved-filter-name-${page}`}>Name for this filter</label>
          <input id={`saved-filter-name-${page}`} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME} placeholder="Name, e.g. Urgent in ICU"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setNaming(false); }}
            className="min-h-8 rounded-full border border-line bg-surface px-3 text-[13px] focus:border-primary focus:outline-none" />
          <label className="inline-flex min-h-8 items-center gap-1.5 px-1 text-muted">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share with my role
          </label>
          <button type="button" onClick={save} disabled={pending || !name.trim()} className="min-h-8 rounded-full bg-primary px-3 font-semibold text-on-primary disabled:opacity-50">Save</button>
          <button type="button" onClick={() => setNaming(false)} className="min-h-8 rounded-full px-2 text-muted hover:text-ink">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => { setNaming(true); setMessage(null); }} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-muted hover:border-primary hover:text-primary-strong">
          <Icon name="bookmark" size={13} /> Save this filter
        </button>
      ))}
      <span role="status" className={message?.error ? "text-danger" : "text-muted"}>{message?.error ?? message?.ok ?? ""}</span>
    </div>
  );
}

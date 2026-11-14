"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";

type Saved = { name: string; query: string };
const keyFor = (pathname: string) => `pams.filters.${pathname}`;
const read = (k: string): Saved[] => { try { return JSON.parse(window.localStorage.getItem(k) ?? "[]") as Saved[]; } catch { return []; } };
const write = (k: string, v: Saved[]) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: not remembered */ } };

/**
 * Saved filters for a list (wave 21): keeps the current filters and sort under a name, in this browser, and shows
 * them as chips above the list. Put it on any list page whose filters live in the address.
 */
export function SavedFilters() {
  const pathname = usePathname(), sp = useSearchParams();
  const [saved, setSaved] = useState<Saved[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { const t = setTimeout(() => setSaved(read(keyFor(pathname))), 0); return () => clearTimeout(t); }, [pathname]);
  const q = new URLSearchParams(sp); q.delete("page");
  const query = q.toString();
  const update = (next: Saved[]) => { setSaved(next); write(keyFor(pathname), next); };
  const save = () => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    update([...saved.filter((s) => s.name !== n), { name: n, query }].slice(-10));
    setName(""); setNaming(false);
  };
  if (!query && saved.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
      {saved.length > 0 && <span className="text-muted">Saved filters:</span>}
      {saved.map((s) => {
        const on = s.query === query;
        return (
          <span key={s.name} className={`inline-flex items-center rounded-full border ${on ? "border-primary bg-primary-soft text-primary-strong" : "border-line bg-surface"}`}>
            <Link href={s.query ? `${pathname}?${s.query}` : pathname} aria-current={on ? "true" : undefined} className="inline-flex min-h-8 items-center gap-1.5 pl-3 pr-1 font-semibold"><Icon name="bookmark" size={13} />{s.name}</Link>
            <button type="button" onClick={() => update(saved.filter((x) => x.name !== s.name))} aria-label={`Remove saved filter ${s.name}`} className="grid size-8 place-items-center rounded-full text-muted hover:text-danger"><Icon name="close" size={12} /></button>
          </span>
        );
      })}
      {query && !saved.some((s) => s.query === query) && (naming ? (
        <span className="inline-flex items-center gap-1.5">
          <label className="sr-only" htmlFor="saved-filter-name">Name for this filter</label>
          <input id="saved-filter-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name, e.g. Urgent in ICU"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") setNaming(false); }}
            className="min-h-8 rounded-full border border-line bg-surface px-3 text-[13px] focus:border-primary focus:outline-none" />
          <button type="button" onClick={save} className="min-h-8 rounded-full bg-primary px-3 font-semibold text-white">Save</button>
          <button type="button" onClick={() => setNaming(false)} className="min-h-8 rounded-full px-2 text-muted hover:text-ink">Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setNaming(true)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-muted hover:border-primary hover:text-primary-strong">
          <Icon name="bookmark" size={13} /> Save this filter
        </button>
      ))}
    </div>
  );
}

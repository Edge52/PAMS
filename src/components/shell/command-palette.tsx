"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Permission } from "@/lib/auth/permissions";
import { modulesFor, OVERVIEW } from "@/lib/modules";
import { Icon } from "@/components/ui/icons";

type Item = { href: string; label: string; group: string };

/**
 * Jump to any page (wave 21): Ctrl+K or ⌘K, or the button in the top bar. Type part of a page's name and press
 * Enter; with no match, Enter searches everything for what was typed.
 */
export function CommandPalette({ perms, assistant }: { perms: Permission[]; assistant: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const items = useMemo<Item[]>(() => [
    ...OVERVIEW.filter((l) => l.flag !== "assistant" || assistant).map((l) => ({ href: l.href, label: l.label, group: "Overview" })),
    ...modulesFor(perms).flatMap((m) => m.links.map((l) => ({ href: l.href, label: l.label, group: m.name }))),
    { href: "/account", label: "Your account", group: "Overview" }, { href: "/notifications", label: "Notifications", group: "Overview" },
  ], [perms, assistant]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const found = words.length ? items.filter((i) => words.every((w) => `${i.label} ${i.group}`.toLowerCase().includes(w))) : items;
  const shown = found.slice(0, 12);

  const open = () => { setQ(""); setAt(0); dialog.current?.showModal(); };
  const go = (href: string) => { dialog.current?.close(); router.push(href); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (dialog.current?.open) dialog.current.close(); else open(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" onClick={open} className="hidden min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] text-muted hover:border-primary hover:text-ink sm:inline-flex" aria-label="Jump to a page (Ctrl+K)">
        <Icon name="grid" size={15} /> Jump to <kbd className="rounded border border-line px-1.5 text-[11px]">Ctrl K</kbd>
      </button>
      <dialog ref={dialog} aria-label="Jump to a page" className="m-auto mt-[12vh] w-[min(92vw,560px)] rounded-[var(--radius-panel)] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-nav/50">
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); const pick = shown[at]; go(pick ? pick.href : `/search?q=${encodeURIComponent(q.trim())}`); }}>
          <label className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Icon name="search" className="text-muted" />
            <span className="sr-only">Page name</span>
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Jump to a page, or search everything"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              }}
              role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
            <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
          </label>
          <ul id="palette-list" role="listbox" aria-label="Pages" className="max-h-[50vh] overflow-y-auto p-2">
            {shown.map((i, n) => (
              <li key={i.href + i.group} id={`palette-${n}`} role="option" aria-selected={n === at}>
                <button type="button" onClick={() => go(i.href)} onMouseEnter={() => setAt(n)}
                  className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 text-left text-[14px] ${n === at ? "bg-primary-soft text-primary-strong" : ""}`}>
                  <span className="font-semibold">{i.label}</span><span className="text-xs text-muted">{i.group}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">No page with that name. Press Enter to search everything for “{q.trim()}”.</li>}
          </ul>
        </form>
      </dialog>
    </>
  );
}

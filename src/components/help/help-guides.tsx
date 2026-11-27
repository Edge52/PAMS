"use client";

import Link from "next/link";
import { useState } from "react";
import { searchGuides, type HelpGuide } from "@/lib/help";

/** The task guides with a search box (wave 41). Filters as you type; the list comes from the server, already cut to the role. */
export function HelpGuides({ guides, initial = "" }: { guides: HelpGuide[]; initial?: string }) {
  const [q, setQ] = useState(initial);
  const shown = searchGuides(guides, q);
  return (
    <div>
      <div className="mb-5 max-w-md">
        <label htmlFor="help-search" className="mb-1 block text-sm font-semibold">Search the guides</label>
        <input id="help-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. tender, PPM, backup"
          className="min-h-9 w-full rounded-full border border-line bg-surface px-4 py-1.5 text-sm placeholder:text-faint focus:border-primary focus:outline-none" />
      </div>
      <p className="sr-only" aria-live="polite">{shown.length} guides shown</p>
      {shown.length === 0 && <p className="text-sm text-muted">No guide matches. Try another word, or use the search box at the top for records.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((g) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <h2 id={`${g.id}-title`} className="text-lg font-semibold text-ink">{g.title}</h2>
            <p className="mt-1 text-sm text-muted">{g.summary}</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
              {g.steps.map((s, i) => (
                <li key={i}>
                  {s.text}
                  {s.href && <> <Link href={s.href} className="font-semibold text-primary hover:underline">{s.link ?? "Open"} ›</Link></>}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

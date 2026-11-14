"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Shown when a page fails (wave 21): what happened in plain words, a way to retry and a way out. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
      <h1 className="font-display text-[28px] leading-tight">This page couldn&apos;t be shown</h1>
      <p className="mt-2 text-sm text-muted">Something went wrong while loading it. Your data is safe. Try again; if it keeps happening, tell the administrator{error.digest ? <> and quote <span className="font-mono text-ink">{error.digest}</span></> : null}.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button type="button" onClick={reset} className="min-h-9 rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong">Try again</button>
        <Link href="/" className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">Go to the dashboard</Link>
      </div>
    </div>
  );
}

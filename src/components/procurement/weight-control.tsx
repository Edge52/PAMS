"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Technical / financial weight slider. Updates ?tw= so the server recomputes the evaluation. */
export function WeightControl({ projectId, technical }: { projectId: number; technical: number }) {
  const router = useRouter();
  const [value, setValue] = useState(technical);
  const [pending, start] = useTransition();
  const apply = (v: number) => start(() => router.replace(`/procurement/${projectId}?tab=comparison&tw=${v}`, { scroll: false }));

  return (
    <form
      className="flex flex-wrap items-center gap-3"
      onSubmit={(e) => { e.preventDefault(); apply(value); }}
      action={`/procurement/${projectId}`}
    >
      <input type="hidden" name="tab" value="comparison" />
      <label htmlFor="tw" className="text-sm font-semibold">Weighting</label>
      <span className="w-28 text-sm tabular-nums">Technical <strong>{value}%</strong></span>
      <input
        id="tw" name="tw" type="range" min={0} max={100} step={5} value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={() => apply(value)}
        onKeyUp={(e) => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") apply(value); }}
        className="w-48 accent-[var(--color-primary)]"
        aria-valuetext={`${value}% technical, ${100 - value}% financial`}
      />
      <span className="w-28 text-sm tabular-nums">Financial <strong>{100 - value}%</strong></span>
      <span className="flex gap-1">
        {[70, 80, 50].map((p) => (
          <button key={p} type="button" onClick={() => { setValue(p); apply(p); }}
            className={`rounded-[var(--radius-control)] border px-2 py-0.5 text-xs font-semibold ${value === p ? "border-primary bg-primary-soft text-primary-strong" : "border-line hover:bg-sunken"}`}>
            {p}/{100 - p}
          </button>
        ))}
      </span>
      {pending && <span className="text-xs text-muted" aria-live="polite">Recalculating…</span>}
    </form>
  );
}

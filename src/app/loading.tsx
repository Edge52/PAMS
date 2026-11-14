/** Shown while any page loads (wave 21): the shape of a page, so the wait doesn't look like a blank screen. */
export default function Loading() {
  const bar = "animate-pulse rounded-full bg-sunken";
  return (
    <div role="status" aria-live="polite" className="pt-8 md:pt-0">
      <span className="sr-only">Loading…</span>
      <div className={`${bar} h-9 w-64`} />
      <div className={`${bar} mt-3 h-4 w-96 max-w-full`} />
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-[var(--radius-panel)] border border-line bg-surface" />)}
      </div>
      <div className="mt-6 h-72 animate-pulse rounded-[var(--radius-panel)] border border-line bg-surface" />
    </div>
  );
}

import Link from "next/link";

export const metadata = { title: "Not found" };

/** Shown for an address that leads nowhere (wave 21). */
export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)]">
      <h1 className="font-display text-[28px] leading-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The record may have been removed, or the link is out of date. You may also not have access to it.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/modules" className="inline-flex min-h-9 items-center rounded-full border border-primary bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-strong">All modules</Link>
        <Link href="/" className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:bg-sunken">Dashboard</Link>
      </div>
    </div>
  );
}

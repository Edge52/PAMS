import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { globalSearch } from "@/lib/search";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireUser();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const groups = await globalSearch(q, me);
  const total = groups.reduce((t, g) => t + g.hits.length, 0);
  return (
    <>
      <PageHeader title="Search" description="Equipment (tag, serial, maker, model, tags), device types, makes and models, rooms, departments, work orders, suppliers, tenders, purchase orders and BOQs." />
      <form action="/search" role="search" className="mb-5 flex gap-2">
        <label htmlFor="search-page-q" className="sr-only">Search</label>
        <input id="search-page-q" type="search" name="q" defaultValue={q} autoFocus placeholder="e.g. ventilator, DGH-MON-000042, Philips, ICU, PO-2026"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 focus:border-primary focus:outline-none" />
        <button className="rounded-[var(--radius-control)] bg-primary px-4 py-2 font-semibold text-white hover:bg-primary-strong">Search</button>
      </form>
      {q.length < 2 ? <p className="text-sm text-muted">Type at least two letters.</p> : total === 0 ? (
        <EmptyState title={`Nothing found for “${q}”`}>Try part of a tag or serial number, a maker, a room code or a document number.</EmptyState>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted" aria-live="polite">{total}{groups.some((g) => g.more) ? "+" : ""} results for “{q}”</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map((g) => (
              <Panel key={g.key} title={g.label} padded={false} actions={g.more ? <Link href={g.more} className="text-sm font-semibold text-primary hover:underline">See all</Link> : undefined}>
                <ul className="divide-y divide-line">
                  {g.hits.map((h) => (
                    <li key={h.href}><Link href={h.href} className="block px-4 py-2 hover:bg-sunken">
                      <span className="block font-semibold text-primary">{h.title}</span>
                      {h.detail && <span className="block text-xs text-muted">{h.detail}</span>}
                    </Link></li>
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </>
      )}
    </>
  );
}

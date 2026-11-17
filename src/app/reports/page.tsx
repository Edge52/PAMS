import Link from "next/link";
import { Input, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { REPORTS } from "@/lib/reports/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

type Card = { href: string; title: string; description: string };
const EXEC: Card = {
  href: "/reports/executive", title: "Executive summary",
  description: "One page per hospital: what needs attention, equipment availability, maintenance performance, contracts and purchasing.",
};
/** Report library (wave 26): grouped by subject, each role's own group first, with a search box. */
const GROUPS: { id: string; title: string; slugs: string[] }[] = [
  { id: "summary", title: "Summary", slugs: [] },
  { id: "maintenance", title: "Maintenance", slugs: ["work-orders", "ppm-compliance"] },
  { id: "assets", title: "Assets", slugs: ["assets-by-department", "warranty-expiries"] },
  { id: "safety", title: "Safety and security", slugs: ["incidents", "device-security"] },
  { id: "procurement", title: "Procurement", slugs: ["tender-status", "open-purchase-orders"] },
  { id: "money", title: "Money", slugs: ["book-value", "service-cost"] },
];
const ROLE_FIRST: Record<string, string> = {
  TECHNICIAN: "maintenance", BIOMEDICAL: "maintenance", DEPARTMENT_HEAD: "assets", PROCUREMENT: "procurement", FINANCE: "money", DIRECTOR: "summary",
};

export default async function ReportsIndex({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requirePermission("reports.view");
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const first = ROLE_FIRST[me.role];
  const groups = [...GROUPS].sort((a, b) => Number(b.id === first) - Number(a.id === first))
    .map((g) => ({
      ...g,
      cards: (g.id === "summary" ? [EXEC] : g.slugs.map((slug) => REPORTS.find((r) => r.slug === slug)).filter((r) => !!r)
        .map((r) => ({ href: `/reports/${r.slug}`, title: r.title, description: r.description })))
        .filter((c) => !q || `${c.title} ${c.description} ${g.title}`.toLowerCase().includes(q)),
    })).filter((g) => g.cards.length);
  const count = groups.reduce((n, g) => n + g.cards.length, 0);
  return (
    <>
      <PageHeader title="Reports" description="Filter by facility and dates, print or save as PDF, or export to Excel. You only see facilities you have access to." />
      <form className="mb-6 flex max-w-md items-end gap-2" role="search">
        <label className="flex-1">
          <span className="sr-only">Find a report</span>
          <Input type="search" name="q" defaultValue={q} placeholder="Find a report, e.g. warranty, incidents" />
        </label>
        <button type="submit" className="min-h-9 rounded-full border border-line bg-surface px-4 text-sm font-semibold hover:border-primary">Find</button>
      </form>
      {q && <p className="mb-4 text-sm text-muted" role="status">{count ? `${count} report${count === 1 ? "" : "s"} for “${q}”.` : `No report matches “${q}”.`} <Link href="/reports" className="font-semibold text-primary underline">Show all</Link></p>}
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`rg-${g.id}`}>
            <h2 id={`rg-${g.id}`} className="mb-2 text-[15px] font-semibold text-muted">{g.title}</h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.cards.map((c) => (
                <li key={c.href}>
                  <Link href={c.href} className="block h-full rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)] hover:border-primary">
                    <span className="block font-semibold text-primary">{c.title}</span>
                    <span className="mt-1 block text-sm text-muted">{c.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

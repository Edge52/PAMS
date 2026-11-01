import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth/session";
import { REPORTS } from "@/lib/reports/registry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };

const GROUPS: { title: string; slugs: string[] }[] = [
  { title: "Procurement", slugs: ["tender-status", "open-purchase-orders"] },
  { title: "Assets and maintenance", slugs: ["assets-by-department", "warranty-expiries", "ppm-compliance"] },
];

export default async function ReportsIndex() {
  await requirePermission("reports.view");
  return (
    <>
      <PageHeader title="Reports" description="Filter by facility and dates, print or save as PDF, or export to Excel. You only see facilities you have access to." />
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-[15px] font-semibold text-muted">Summary</h2>
          <Link href="/reports/executive" className="block rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 hover:border-primary md:max-w-md">
            <span className="block font-semibold text-primary">Executive summary</span>
            <span className="mt-1 block text-sm text-muted">One page per hospital: what needs attention, equipment availability, maintenance performance, contracts and purchasing. Print or save as PDF.</span>
          </Link>
        </section>
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h2 className="mb-2 text-[15px] font-semibold text-muted">{g.title}</h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.slugs.map((slug) => REPORTS.find((r) => r.slug === slug)).filter((r) => !!r).map((r) => (
                <li key={r.slug}>
                  <Link href={`/reports/${r.slug}`} className="block h-full rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3 hover:border-primary">
                    <span className="block font-semibold text-primary">{r.title}</span>
                    <span className="mt-1 block text-sm text-muted">{r.description}</span>
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

import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { ReportFiltersForm } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requirePermission } from "@/lib/auth/session";
import { APP_TIME_ZONE } from "@/lib/format";
import { filtersToQuery } from "@/lib/reports/calc";
import { findReport } from "@/lib/reports/registry";
import { runReport } from "@/lib/reports/run";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const def = findReport((await params).slug);
  return { title: def ? def.title : "Report" };
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const me = await requirePermission("reports.view");
  const { slug } = await params;
  const def = findReport(slug);
  if (!def) notFound();
  const run = await runReport(def, await searchParams, me);
  if (run.forbidden) redirect("/forbidden?need=facility");
  const { filters, result, lines, facilities } = run;
  const exportHref = `/reports/${def.slug}/export${filtersToQuery(filters, def.filters)}`;
  const generated = new Date().toLocaleString("en-GB", { timeZone: APP_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <ReportPrintStyles />
      <PageHeader
        title={def.title}
        description={def.description}
        back={{ href: "/reports", label: "Reports" }}
        actions={<div className="no-print flex flex-wrap gap-2">
          <PrintButton />
          <a href={exportHref} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong">
            Export to Excel
          </a>
        </div>}
      />

      <ReportFiltersForm action={`/reports/${def.slug}`} kinds={def.filters} filters={filters} facilities={facilities} dateLabel={def.dateLabel} />

      <div className="print-only mb-3 text-xs">
        {lines.map((l) => <p key={l}>{l}</p>)}
        <p>Generated {generated} by {me.name}</p>
      </div>

      {result.summary && result.summary.length > 0 && (
        <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-3">
          {result.summary.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="text-lg font-bold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="space-y-6">
        {result.sections.map((s) => (
          <section key={s.key} className="report-section">
            {s.title && <h2 className="mb-2 text-[15px] font-semibold">{s.title}</h2>}
            <ReportTable section={s} />
          </section>
        ))}
      </div>

      {result.notes && result.notes.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {result.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </>
  );
}

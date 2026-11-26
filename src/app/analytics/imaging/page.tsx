import Link from "next/link";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { EmptyState, Panel, Table, Td, Th, THead } from "@/components/ui";
import { parseFilters } from "@/lib/analytics/core";
import { BENCHMARK, MONTHS, WEEKDAYS } from "@/lib/analytics/imaging";
import { imagingAnalytics } from "@/lib/analytics/imaging-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: imaging" };

const pct = (x: number | null) => (x == null ? "—" : `${formatNumber(x * 100, 0)} %`);
const n0 = (x: number | null) => (x == null ? "—" : formatNumber(x));

/** Exams by weekday and month, idle scanner capacity and exams per scanner per year (wave 40). */
export default async function ImagingAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const f = parseFilters(await searchParams, todayISO());
  const ids = await analyticsScope(me, f);
  const a = await imagingAnalytics(ids, f);
  const period = { from: f.from, to: f.to };
  const ct = a.modalities.find((m) => m.modality === "CT"), mri = a.modalities.find((m) => m.modality === "MRI");
  const withData = a.scanners.filter((s) => s.months > 0);
  const cap = withData.filter((s) => s.capacity != null);
  const capSum = cap.reduce((s, r) => s + r.capacity!, 0);

  if (!a.scanners.length) {
    return <><AnalyticsFilters filters={f} /><EmptyState title="No scanners in this selection" action={<Link className="text-primary hover:underline" href="/assets/imaging">Open Imaging use</Link>}>Imaging devices (CT, MRI, X-ray…) in use appear here once they are in the register.</EmptyState></>;
  }
  return (
    <>
      <AnalyticsFilters filters={f} />
      <KpiGrid>
        <KpiCard period={period} kpi={{ label: "Exams", value: withData.reduce((s, r) => s + r.exams, 0), unit: "number", formula: "Exams recorded in the months of the period", n: withData.length }} />
        <KpiCard period={period} kpi={{ label: "Idle capacity", value: capSum > 0 ? cap.reduce((s, r) => s + r.idle!, 0) / capSum : null, unit: "share", formula: "(Capacity − exams) ÷ capacity, scanners with figures", n: cap.length }} />
        <KpiCard period={period} kpi={{ label: "CT exams per scanner a year", value: ct?.perYear ?? null, unit: "number", formula: "Exams ÷ months with figures × 12, average per CT", n: ct?.scanners ?? 0,
          benchmark: { text: `about ${formatNumber(BENCHMARK.CT)} a year`, source: BENCHMARK.source } }} />
        <KpiCard period={period} kpi={{ label: "MRI exams per scanner a year", value: mri?.perYear ?? null, unit: "number", formula: "Exams ÷ months with figures × 12, average per MRI", n: mri?.scanners ?? 0,
          benchmark: { text: `about ${formatNumber(BENCHMARK.MRI)} a year`, source: BENCHMARK.source } }} />
      </KpiGrid>

      <Panel title="Exams by weekday and month">
        <p className="mb-3 text-sm text-muted">
          The exam file has one count per scanner per day, with no time of day, so this shows weekday × month instead of hour × weekday.
          Each cell is the average exams per day (all chosen scanners together). {formatNumber(a.heat.days)} days with figures.
        </p>
        {a.heat.days === 0 ? (
          <p className="text-sm text-muted">No daily exam counts in this period. Import them under <Link className="text-primary hover:underline" href="/assets/imaging/import">Imaging use › Import</Link>.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs tabular-nums" aria-label="Average exams per day by weekday and month">
              <thead><tr><th className="px-1 py-1" />{MONTHS.map((m) => <th key={m} scope="col" className="px-1 py-1 font-semibold text-muted">{m}</th>)}</tr></thead>
              <tbody>
                {WEEKDAYS.map((d, i) => (
                  <tr key={d}>
                    <th scope="row" className="px-1 py-1 text-left font-semibold text-muted">{d}</th>
                    {a.heat.rows[i].map((c, j) => (
                      <td key={j} className="p-0.5">
                        <div className="relative h-8 w-12 overflow-hidden rounded border border-line bg-sunken" title={c.avg == null ? "No data" : `${formatNumber(c.avg, 1)} a day over ${c.days} days`}>
                          {c.avg != null && <div className="absolute inset-0 bg-primary" style={{ opacity: a.heat.max ? 0.1 + 0.8 * (c.avg / a.heat.max) : 0 }} />}
                          <span className="relative flex h-full items-center justify-center">{c.avg == null ? "" : <span className="rounded bg-surface px-1 text-xs font-semibold text-ink">{formatNumber(c.avg, 0)}</span>}</span>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="mt-5" />
      <Panel title="Scanners" padded={false}>
        <Table>
          <THead><tr><Th>Scanner</Th><Th>Type</Th>{ids.length > 1 && <Th>Hospital</Th>}<Th align="right">Months</Th><Th align="right">Exams</Th><Th align="right">Capacity</Th><Th align="right">Idle</Th><Th align="right">Exams a year</Th><Th align="right">Against benchmark</Th></tr></THead>
          <tbody>
            {a.scanners.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <Td><Link className="font-mono text-primary hover:underline" href={`/assets/${s.id}`}>{s.tag}</Link></Td>
                <Td>{s.typeName}</Td>{ids.length > 1 && <Td>{s.facility}</Td>}
                <Td align="right">{s.months}</Td><Td align="right">{n0(s.exams)}</Td>
                <Td align="right">{n0(s.capacity == null ? null : Math.round(s.capacity))}{s.capacitySource === "hint" && <span className="ml-1 text-xs text-muted">(hint)</span>}</Td>
                <Td align="right">{s.idle == null ? "—" : `${n0(Math.round(s.idle))} (${pct(s.idleShare)})`}</Td>
                <Td align="right">{n0(s.perYear == null ? null : Math.round(s.perYear))}</Td>
                <Td align="right">{pct(s.vsBenchmark)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      {a.truncated && <p className="mt-2 text-sm text-warn">Only the first 500 scanners are shown.</p>}
      <p className="mt-3 text-xs text-muted">
        Capacity: the hospital&apos;s own figure per device type (Imaging use › Planning capacity), else the hints (CT 12,000 and MRI 6,000 exams a year) for the months with figures.
        Benchmark: {BENCHMARK.source}, about {formatNumber(BENCHMARK.CT)} CT and {formatNumber(BENCHMARK.MRI)} MRI exams per scanner a year.
      </p>
    </>
  );
}

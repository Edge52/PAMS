import Link from "next/link";
import { EmptyState, Panel } from "@/components/ui";
import { BarList } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/data-table";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { comparable, filterQuery, MIN_N, parseFilters, type Kpi } from "@/lib/analytics/core";
import { NOT_ENOUGH } from "@/lib/analytics/format";
import {
  benchTone, BENCHMARKS, failuresByCode, failuresIn, mtbfHours, mttr, noProblemFound, ppmOnTime, ppmYield, repeatFailures, REPEAT_MIN,
  rollUpUptime, uptimeByDevice, uptimeKpi, type UptimeGroup,
} from "@/lib/analytics/maintenance";
import { loadMaintenanceData } from "@/lib/analytics/maintenance-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { failureCodeLabel } from "@/lib/assets/failure-codes";
import { requirePermission } from "@/lib/auth/session";
import { formatNumber, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: maintenance" };

const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(v * 100, 1)} %`);

export default async function MaintenanceAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const sp = await searchParams;
  const today = todayISO();
  const f = parseFilters(sp, today);
  const ids = await analyticsScope(me, f);
  const period = { from: f.from, to: f.to };
  const now = new Date();
  const data = await loadMaintenanceData(f, ids);

  const rows = uptimeByDevice(data.devices, data.downtime, period, now);
  const [fleet] = rollUpUptime(data.devices, rows, () => ({ key: "all", label: "All devices" }));
  const imagingIds = new Set(data.devices.filter((d) => d.imaging).map((d) => d.id));
  const [imaging] = rollUpUptime(data.devices.filter((d) => d.imaging), rows.filter((r) => imagingIds.has(r.id)), () => ({ key: "img", label: "Imaging" }));
  const byType = rollUpUptime(data.devices, rows, (d) => ({ key: String(d.typeId), label: d.typeLabel }));
  const byDept = rollUpUptime(data.devices, rows, (d) => ({ key: String(d.departmentId ?? "none"), label: d.departmentLabel }));

  const failures = failuresIn(data.jobs, period);
  const mtbf = mtbfHours(rows, failures.length);
  const repair = mttr(data.jobs, period);
  const repeats = repeatFailures(data.jobs, period);
  const codes = failuresByCode(data.jobs, period);
  const npf = noProblemFound(data.jobs, period);
  const yieldR = ppmYield(data.visits, period);
  const onTime = ppmOnTime(data.visits, period, today);
  const tag = new Map(data.devices.map((d) => [d.id, d]));

  const kpis: { kpi: Kpi; tone?: "ok" | "warn"; href?: string }[] = [
    { kpi: uptimeKpi(fleet ?? { uptime: null, devices: 0 }), tone: benchTone(fleet?.uptime ?? null, BENCHMARKS.uptimeFleet.value, true) },
    ...(imaging ? [{ kpi: uptimeKpi(imaging, true), tone: benchTone(imaging.uptime, BENCHMARKS.uptimeImaging.value, true) }] : []),
    { kpi: { label: "Mean time between failures", value: mtbf == null ? null : mtbf / 24, unit: "days", n: failures.length,
      formula: "Hours in service ÷ corrective jobs reported in the period" } },
    { kpi: { label: "Mean time to repair", value: repair.hours, unit: "hours", n: repair.n,
      formula: "Average hours from report to completion, corrective jobs completed in the period" }, href: "/reports/work-orders" },
    { kpi: { label: "PPM on time", value: onTime.share, unit: "share", n: onTime.n,
      formula: "Planned visits done within 7 days of their date ÷ visits due in the period" }, href: "/reports/ppm-compliance" },
    { kpi: { label: "PPM yield", value: yieldR.share, unit: "share", n: yieldR.n, formula: "Planned visits that found a fault ÷ planned visits done",
      benchmark: { text: BENCHMARKS.ppmYield.text, source: BENCHMARKS.ppmYield.source } }, tone: benchTone(yieldR.share, BENCHMARKS.ppmYield.value, false) },
    { kpi: { label: "No problem found", value: npf.share, unit: "share", n: npf.n, formula: "Repair calls coded “no problem found” ÷ repair calls with a failure code",
      benchmark: { text: BENCHMARKS.npf.text, source: BENCHMARKS.npf.source } } },
    { kpi: { label: "Repeat failures", value: repeats.length, unit: "number", n: failures.length, formula: `Devices with ${REPEAT_MIN} or more corrective jobs in the period` } },
  ];

  const groupCols = (first: string) => [
    { key: "label", label: first, cell: (g: UptimeGroup) => g.label },
    { key: "devices", label: "Devices", align: "right" as const, cell: (g: UptimeGroup) => formatNumber(g.devices) },
    { key: "down", label: "Hours down", align: "right" as const, cell: (g: UptimeGroup) => formatNumber(g.downHours, 1) },
    { key: "uptime", label: "Uptime", align: "right" as const, cell: (g: UptimeGroup) => {
      if (!comparable(g.devices)) return <span className="text-muted" title={NOT_ENOUGH}>{pct(g.uptime)}*</span>;
      const target = g.imaging ? BENCHMARKS.uptimeImaging.value : BENCHMARKS.uptimeFleet.value;
      return <span className={g.uptime != null && g.uptime < target ? "font-semibold text-warn" : undefined}>{pct(g.uptime)}</span>;
    } },
  ];
  const q = filterQuery(f);

  return (
    <>
      <AnalyticsFilters filters={f} />
      {data.cut && <p className="mb-4 rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">There are more records than this page reads at once: narrow the filters for exact figures.</p>}
      {!data.devices.length ? (
        <EmptyState title="No devices match these filters">Choose another hospital, department or device type.</EmptyState>
      ) : (
        <>
          <KpiGrid>{kpis.map((k) => <KpiCard key={k.kpi.label} kpi={k.kpi} period={period} tone={k.tone} href={k.href} />)}</KpiGrid>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Panel title="Uptime by device type" padded={false}>
              <DataTable id="an-uptime-type" label="Uptime by device type" path="/analytics/maintenance" sp={sp} sort={null} rows={byType.slice(0, 40)} rowKey={(g) => g.key} columns={groupCols("Device type")} />
            </Panel>
            <Panel title="Uptime by department" padded={false}>
              <DataTable id="an-uptime-dept" label="Uptime by department" path="/analytics/maintenance" sp={sp} sort={null} rows={byDept.slice(0, 40)} rowKey={(g) => g.key} columns={groupCols("Department")} />
            </Panel>
          </div>
          <p className="-mt-3 mb-5 text-xs text-muted">Lowest uptime first. Uptime below the benchmark (94 %, imaging 98 %) is marked. * fewer than {MIN_N} devices: shown, not compared.</p>

          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <Panel title="Failures by failure code">
              {codes.length ? (
                <BarList label="Corrective jobs in the period by failure code" data={codes.map((c) => ({ label: failureCodeLabel(c.code) ?? "Not recorded", value: c.count, tone: c.code ? "primary" : "muted" }))} />
              ) : <p className="text-sm text-muted">No corrective jobs in this period.</p>}
              <p className="mt-3 text-xs text-muted">{formatNumber(failures.length)} corrective jobs reported in the period. The code is chosen when a job is completed.</p>
            </Panel>
            <Panel title={`Repeat failures (${REPEAT_MIN} or more jobs)`} padded={false}>
              <DataTable id="an-repeats" label="Devices with repeat failures" path="/analytics/maintenance" sp={sp} sort={null} rows={repeats.slice(0, 50)} rowKey={(r) => r.assetId}
                empty={<p className="p-5 text-sm text-muted">No device had {REPEAT_MIN} or more corrective jobs in this period.</p>}
                columns={[
                  { key: "tag", label: "Device", cell: (r) => <Link href={`/assets/${r.assetId}`} className="text-primary hover:underline">{tag.get(r.assetId)?.tag ?? r.assetId}</Link> },
                  { key: "type", label: "Type", cell: (r) => tag.get(r.assetId)?.typeLabel ?? "—" },
                  { key: "dept", label: "Department", className: "hidden sm:table-cell", cell: (r) => tag.get(r.assetId)?.departmentLabel ?? "—" },
                  { key: "count", label: "Jobs", align: "right", cell: (r) => formatNumber(r.count) },
                ]} />
            </Panel>
          </div>

          <Panel title="How these are worked out">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Uptime counts time, not today&apos;s status: each device&apos;s hours in the period (from its install date, up to now) minus the hours a work order marked it out of use. Overlapping downtime counts once; downtime still open runs to the end of the period or now.</li>
              <li>Groups add up hours, so a large group weighs more than a small one. Imaging means device types under Imaging (IMG) in the catalogue.</li>
              <li>A planned visit found a fault when its job had a failed check or a failure code other than &ldquo;no problem found&rdquo;. Visits without a job count as no fault.</li>
              <li>Comparisons with fewer than {MIN_N} items say &ldquo;{NOT_ENOUGH}&rdquo;. PPM details: <Link href={`/reports/ppm-compliance?${q}`} className="text-primary hover:underline">PPM compliance report</Link>.</li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}

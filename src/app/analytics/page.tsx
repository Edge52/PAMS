import Link from "next/link";
import { and, count, eq, inArray } from "drizzle-orm";
import { Panel } from "@/components/ui";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { tabsFor } from "@/components/analytics/shell";
import { db } from "@/db";
import { assets, workOrders } from "@/db/schema";
import { filterQuery, parseFilters, type Kpi } from "@/lib/analytics/core";
import { benchTone, BENCHMARKS, ppmOnTime, rollUpUptime, uptimeByDevice, uptimeKpi } from "@/lib/analytics/maintenance";
import { deviceCond, loadMaintenanceData } from "@/lib/analytics/maintenance-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { seesPrices } from "@/lib/auth/prices";
import { requirePermission } from "@/lib/auth/session";
import { hospitalScores } from "@/lib/data-quality";
import { loadDqData } from "@/lib/data-quality-server";
import { todayISO } from "@/lib/format";
import { COSR_GUIDE_PCT, COSR_HIGH_PCT } from "@/lib/reports/service-cost-calc";
import { serviceCostTotal } from "@/lib/reports/service-cost";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics" };

const OPEN = ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"] as const;

export default async function AnalyticsOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const sp = await searchParams;
  const today = todayISO();
  const f = parseFilters(sp, today);
  const ids = await analyticsScope(me, f);
  const period = { from: f.from, to: f.to };
  const prices = seesPrices(me.role);

  const [data, [open], cost, dq] = await Promise.all([
    loadMaintenanceData(f, ids),
    db.select({ n: count() }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .where(and(deviceCond(f, ids), inArray(workOrders.status, [...OPEN]))),
    prices ? serviceCostTotal({ filters: { facilityId: f.facilityId, from: f.from, to: f.to, days: 0, grace: 0, projectStatus: "all" }, scope: ids, today }) : Promise.resolve(null),
    loadDqData(f.facilityId, ids, today, prices),
  ]);
  const rows = uptimeByDevice(data.devices, data.downtime, period, new Date());
  const [fleet] = rollUpUptime(data.devices, rows, () => ({ key: "all", label: "All" }));
  const onTime = ppmOnTime(data.visits, period, today);
  const scores = hospitalScores(dq.data.assets, today);
  const dqDevices = scores.reduce((a, s) => a + s.devices, 0);
  const dqClean = scores.reduce((a, s) => a + s.clean, 0);

  const kpis: { kpi: Kpi; tone?: "ok" | "warn" | "danger"; href?: string }[] = [
    { kpi: uptimeKpi(fleet ?? { uptime: null, devices: 0 }), tone: benchTone(fleet?.uptime ?? null, BENCHMARKS.uptimeFleet.value, true), href: `/analytics/maintenance?${filterQuery(f)}` },
    { kpi: { label: "PPM on time", value: onTime.share, unit: "share", n: onTime.n, formula: "Planned visits done within 7 days of their date ÷ visits due in the period" }, href: `/analytics/maintenance?${filterQuery(f)}` },
    { kpi: { label: "Open work orders", value: open?.n ?? 0, unit: "number", n: open?.n ?? 0, formula: "Jobs open, assigned, in progress or on hold now" }, href: "/assets/work-orders" },
    ...(cost ? [{
      kpi: { label: "COSR per year", value: cost.cosrYear == null ? null : cost.cosrYear / 100, unit: "share" as const, n: cost.priced,
        formula: "Service cost ÷ purchase cost of the same devices, scaled to a year (hospital filter only)",
        benchmark: { text: `Under about ${COSR_GUIDE_PCT} % is usually good value`, source: "Service cost and COSR report" } },
      tone: cost.cosrYear == null ? undefined : cost.cosrYear <= COSR_GUIDE_PCT ? "ok" as const : cost.cosrYear <= COSR_HIGH_PCT ? "warn" as const : "danger" as const,
      href: `/reports/service-cost?${new URLSearchParams({ ...(f.facilityId ? { facilityId: String(f.facilityId) } : {}), from: f.from, to: f.to })}`,
    }] : []),
    { kpi: { label: "Data quality", value: dqDevices ? dqClean / dqDevices : null, unit: "share", n: dqDevices, formula: "Devices that pass the high and medium data rules ÷ devices" },
      href: `/reports/data-quality${f.facilityId ? `?facilityId=${f.facilityId}` : ""}` },
  ];

  const tabs = tabsFor(me.role).filter((t) => t.id !== "overview");
  const q = filterQuery(f);
  return (
    <>
      <AnalyticsFilters filters={f} />
      <KpiGrid>{kpis.map((k) => <KpiCard key={k.kpi.label} kpi={k.kpi} period={period} tone={k.tone} href={k.href} />)}</KpiGrid>
      <Panel title="The tabs">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tabs.map((t) => (
            <li key={t.id}>
              <Link href={`${t.href}?${q}`} className="block rounded-[var(--radius-control)] border border-line p-3 hover:border-primary">
                <span className="font-semibold text-primary">{t.label}</span>
                <span className="mt-0.5 block text-sm text-muted">{t.blurb}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link href="/reports/data-quality" className="block rounded-[var(--radius-control)] border border-line p-3 hover:border-primary">
              <span className="font-semibold text-primary">Data quality</span>
              <span className="mt-0.5 block text-sm text-muted">Gaps and mistakes in the records. Better records, better figures.</span>
            </Link>
          </li>
        </ul>
      </Panel>
    </>
  );
}

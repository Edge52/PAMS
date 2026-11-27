import Link from "next/link";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { Badge, EmptyState, Panel } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { comparable, MIN_N, OUTLIER_Z, parseFilters } from "@/lib/analytics/core";
import {
  competition, competitionBy, DECISION_DAYS_BENCHMARK, EARLY_FAULT_DAYS, priceBenchmarks, SCOREBOARD_SOURCE, singleBidTone, supplierScores,
  type Competition,
} from "@/lib/analytics/procurement";
import { loadPrices, loadSupplierFacts, loadTenderUnits, PRICE_YEARS } from "@/lib/analytics/procurement-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { METHOD_LABELS, type ProcurementMethod } from "@/lib/procurement/timetable";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(v * 100, 1)} %`);
const toneCls = (t: "ok" | "warn" | "danger" | null) => (t === "ok" ? "text-ok" : t === "warn" ? "text-warn" : t === "danger" ? "text-danger" : undefined);
const methodLabel = (m: string) => METHOD_LABELS[m as ProcurementMethod] ?? m;

export default async function ProcurementAnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("prices.view");
  const sp = await searchParams;
  const today = todayISO();
  const f = parseFilters(sp, today);
  const scope = await analyticsScope(me, f);
  const period = { from: f.from, to: f.to };

  const [units, prices, facts] = await Promise.all([loadTenderUnits(f, scope, today), loadPrices(f, scope), loadSupplierFacts(f, scope, today)]);
  const all = competition(units);
  const byMethod = competitionBy(units, (u) => [u.method ?? "PUBLIC_TENDER"]);
  const byCategory = competitionBy(units, (u) => (u.categories.length ? u.categories : ["No items listed"]));
  const benchmarks = priceBenchmarks(prices.paid);
  const shownBench = benchmarks.filter((b) => b.shown);
  const scores = supplierScores(facts);
  const ranked = scores.some((s) => s.rank != null);

  const groupCols = (first: string) => [
    { key: "key", label: first, cell: (r: { key: string } & Competition) => (first === "Method" ? methodLabel(r.key) : r.key) },
    { key: "units", label: "RFQs", align: "right" as const, cell: (r: Competition) => formatNumber(r.units) },
    { key: "bids", label: "Bids per RFQ", align: "right" as const, cell: (r: Competition) => (r.meanBids == null ? "—" : formatNumber(r.meanBids, 1)) },
    { key: "single", label: "Single bid", align: "right" as const, cell: (r: Competition) => (comparable(r.withBids) ? <span className={toneCls(singleBidTone(r.singleBidShare))}>{pct(r.singleBidShare)}</span> : <span className="text-muted">n &lt; {MIN_N}</span>) },
    { key: "none", label: "No offers", align: "right" as const, cell: (r: Competition) => (comparable(r.closed) ? pct(r.noOfferShare) : <span className="text-muted">n &lt; {MIN_N}</span>) },
    { key: "days", label: "Days to award (median)", align: "right" as const, cell: (r: Competition) => (comparable(r.decisionDays.length) ? <span className={r.medianDecisionDays! > DECISION_DAYS_BENCHMARK ? "text-warn" : undefined}>{formatNumber(r.medianDecisionDays, 0)}</span> : <span className="text-muted">n &lt; {MIN_N}</span>) },
  ];

  return (
    <>
      <AnalyticsFilters filters={f} />

      <KpiGrid>
        <KpiCard period={period} kpi={{ label: "Single-bid share", value: all.singleBidShare, unit: "share", n: all.withBids,
          formula: "RFQs with exactly one bid ÷ closed RFQs with at least one bid", benchmark: { text: "10 % or less is good, over 20 % is poor", source: SCOREBOARD_SOURCE } }} />
        <KpiCard period={period} kpi={{ label: "RFQs with no offers", value: all.noOfferShare, unit: "share", n: all.closed, formula: "Closed RFQs with no bid ÷ closed RFQs" }} />
        <KpiCard period={period} kpi={{ label: "Bids per RFQ", value: all.meanBids, unit: "number", n: all.withBids, formula: "Bids received ÷ RFQs with at least one bid (withdrawn left out)" }} />
        <KpiCard period={period} kpi={{ label: "Days from RFQ to award", value: all.medianDecisionDays, unit: "days", n: all.decisionDays.length,
          formula: "Median days from the RFQ's issue date to the award approval", benchmark: { text: `${DECISION_DAYS_BENCHMARK} days or less`, source: SCOREBOARD_SOURCE } }} />
      </KpiGrid>

      <div className="space-y-5">
        <Panel title="Tender competition">
          {units.length === 0 ? (
            <EmptyState title="No RFQs issued in this period">Issue RFQs from a project, or pick a longer period.</EmptyState>
          ) : (
            <div className="space-y-5">
              <DataTable id="by-method" label="Competition by method" path="/analytics/procurement" sp={sp} sort={null} rows={byMethod} rowKey={(r) => r.key} columns={groupCols("Method")} />
              <DataTable id="by-category" label="Competition by category" path="/analytics/procurement" sp={sp} sort={null} rows={byCategory} rowKey={(r) => r.key} columns={groupCols("Category")} />
              <p className="text-xs text-muted">
                RFQs issued in the period. An RFQ is closed when its status is closed, its closing date has passed or offers are in; open ones are left out of
                the shares. An RFQ asking for several categories counts in each. No method set is read as a public tender. Shares on fewer than {MIN_N} RFQs are hidden.
                {all.overBenchmark > 0 && ` ${all.overBenchmark} award${all.overBenchmark === 1 ? "" : "s"} took more than ${DECISION_DAYS_BENCHMARK} days.`}
              </p>
            </div>
          )}
        </Panel>

        <Panel title="Prices against earlier prices paid">
          {prices.flags.length > 0 ? (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold">Offers well above earlier prices ({prices.flags.length} of {formatNumber(prices.checked)} offer lines in the period)</h3>
              <DataTable id="flags" label="Offer prices well above earlier prices" path="/analytics/procurement" sp={sp} sort={null} rows={prices.flags.slice(0, 50)} rowKey={(r) => r.point.lineId}
                columns={[
                  { key: "offer", label: "Offer", cell: (r) => <Link href={r.point.href} className="text-primary hover:underline">{r.point.ref}</Link> },
                  { key: "type", label: "Device type and model", cell: (r) => <>{r.point.typeName}<span className="block text-xs text-muted">{[r.point.manufacturer, r.point.model].filter(Boolean).join(" ") || "No model"}</span></> },
                  { key: "date", label: "Offer date", cell: (r) => formatDate(r.point.date) },
                  { key: "price", label: "Unit price (EGP)", align: "right", cell: (r) => formatMoney(r.point.egp, "EGP") },
                  { key: "median", label: "Earlier median (EGP)", align: "right", cell: (r) => <>{formatMoney(r.median, "EGP")}<span className="block text-xs text-muted">n = {r.n}, same {r.basis}</span></> },
                  { key: "z", label: "Score", align: "right", cell: (r) => <Badge tone="warn">{formatNumber(r.z, 1)}</Badge> },
                ]} />
            </div>
          ) : (
            <p className="mb-5 text-sm text-muted">No offer in the period is well above earlier prices ({formatNumber(prices.checked)} offer lines checked).</p>
          )}
          {shownBench.length === 0 ? (
            <EmptyState title={`No device type has ${MIN_N} or more prices yet`}>Benchmarks appear once a device type has been bought or awarded at least {MIN_N} times.</EmptyState>
          ) : (
            <DataTable id="benchmarks" label="Prices paid by device type and model" path="/analytics/procurement" sp={sp} sort={null} rows={shownBench} rowKey={(b) => b.key}
              columns={[
                { key: "type", label: "Device type", cell: (b) => (b.model ? <span className="pl-4 text-muted">{b.model}</span> : <span className="font-semibold">{b.typeName}</span>) },
                { key: "n", label: "Prices", align: "right", cell: (b) => formatNumber(b.n) },
                { key: "median", label: "Median (EGP)", align: "right", cell: (b) => formatMoney(b.median, "EGP") },
                { key: "range", label: "Range (EGP)", align: "right", cell: (b) => `${formatMoney(b.min, "EGP", { compact: true })} – ${formatMoney(b.max, "EGP", { compact: true })}` },
              ]} />
          )}
          {prices.missing.length > 0 && <p className="mt-3 text-sm text-warn">No exchange rate stored for {prices.missing.join(", ")}: those prices are left out.</p>}
          <p className="mt-3 text-xs text-muted">
            Prices paid: unit prices on approved and issued orders and on awarded offers with no order yet, net of discount, in EGP at the rate on the order or
            offer date, over the {PRICE_YEARS} years up to {formatDate(f.to)}. Types or models with fewer than {MIN_N} prices are hidden
            ({benchmarks.length - shownBench.length} hidden). An offer is flagged when its robust score (distance from the median of earlier prices ÷ 1.4826 × MAD)
            is above {OUTLIER_Z}. Offers of a two-envelope tender are checked only after its financial envelopes are opened.
          </p>
        </Panel>

        <Panel title="Supplier scorecard">
          {scores.length === 0 ? (
            <EmptyState title="No orders, awards or contracts in this period">Pick a longer period or another hospital.</EmptyState>
          ) : (
            <DataTable id="suppliers" label="Supplier scorecard" path="/analytics/procurement" sp={sp} sort={null} rows={scores.slice(0, 100)} rowKey={(s) => s.supplierId}
              columns={[
                ...(ranked ? [{ key: "rank", label: "Rank", align: "right" as const, cell: (s: (typeof scores)[number]) => (s.rank ?? <span className="text-muted">—</span>) }] : []),
                { key: "name", label: "Supplier", cell: (s) => <Link href={`/procurement/suppliers/${s.supplierId}`} className="text-primary hover:underline">{s.name}</Link> },
                { key: "ontime", label: "On time", align: "right", cell: (s) => <>{pct(s.onTimeShare)}<span className="block text-xs text-muted">n = {s.n}</span></> },
                { key: "delay", label: "Average delay", align: "right", cell: (s) => (s.avgDelayDays == null ? "—" : `${formatNumber(s.avgDelayDays, 1)} days`) },
                { key: "penalty", label: "Penalties", align: "right", cell: (s) => (s.penaltyCount ? <>{formatMoney(s.penaltyEgp, "EGP", { compact: true })}<span className="block text-xs text-muted">{s.penaltyCount} invoice{s.penaltyCount === 1 ? "" : "s"}</span></> : "—") },
                { key: "faults", label: `Faults within ${EARLY_FAULT_DAYS} days`, align: "right", cell: (s) => (s.earlyFaultShare == null ? "—" : <>{pct(s.earlyFaultShare)}<span className="block text-xs text-muted">of {s.devicesInstalled} devices</span></>) },
                { key: "uptime", label: "Uptime target met", align: "right", cell: (s) => (s.uptimeOf ? `${s.uptimeMet} of ${s.uptimeOf}` : "—") },
                { key: "response", label: "Response (median, covered hours)", align: "right", cell: (s) => (s.medianResponseH == null ? "—" : <>{formatNumber(s.medianResponseH, 1)} h<span className="block text-xs text-muted">n = {s.responseN}</span></>) },
                { key: "awards", label: "Awards", align: "right", cell: (s) => formatNumber(s.awards) },
              ]} />
          )}
          <p className="mt-3 text-xs text-muted">
            On time: orders due in the period, delivered in full on or before the expected date (late orders still open count as late). Penalties: late-delivery
            penalties deducted on invoices in the period, in EGP. Faults: devices from the supplier&apos;s orders installed in the period with a repair job within
            {" "}{EARLY_FAULT_DAYS} days. Uptime: service contracts with an uptime target, over their part of the period (every hour counted). Response: hours from report
            to start of work on jobs under the supplier&apos;s contracts. Suppliers are ranked by on-time share only with {MIN_N} or more orders due. Department and
            device type filters don&apos;t apply to the scorecard.
          </p>
        </Panel>
      </div>
    </>
  );
}

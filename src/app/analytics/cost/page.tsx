import Link from "next/link";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { ShareStrip } from "@/components/analytics/share-strip";
import { EmptyState, Panel, TabLinks } from "@/components/ui";
import { BarList } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/data-table";
import { filterQuery, parseFilters, type Filters } from "@/lib/analytics/core";
import { cosrByType, loadSpend } from "@/lib/analytics/cost-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { groupSpend, parseBasis, parseDim, SPEND_DIMS, spendTotal, topN, topShare, type SpendGroup } from "@/lib/analytics/spend";
import { requirePermission } from "@/lib/auth/session";
import { formatMoney, formatNumber, todayISO } from "@/lib/format";
import { cosrTone, COSR_NOTE } from "@/lib/reports/service-cost-calc";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const TOP = 10;
const pct = (v: number | null) => (v == null ? "—" : `${formatNumber(v * 100, 1)} %`);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function groupHref(dim: string, g: SpendGroup): string | null {
  if (g.id == null) return null;
  if (dim === "supplier") return `/procurement/suppliers/${g.id}`;
  if (dim === "department") return `/assets?departmentId=${g.id}`;
  return null;
}

export default async function CostPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("prices.view");
  const sp = await searchParams;
  const today = todayISO();
  const f: Filters = parseFilters(sp, today);
  const scope = await analyticsScope(me, f);
  const basis = parseBasis(one(sp.basis));
  const dim = parseDim(one(sp.by));
  const period = { from: f.from, to: f.to };

  const [spend, cosr] = await Promise.all([loadSpend(f, scope, basis), cosrByType(f, scope, today)]);
  const total = spendTotal(spend.lines);
  const groups = groupSpend(spend.lines, dim);
  const shown = dim === "year" ? groups : topN(groups, TOP);
  const suppliers = groupSpend(spend.lines, "supplier");
  const lineCount = spend.lines.reduce((s, l) => s + l.lines, 0);
  const q = filterQuery(f);
  const link = (o: { basis?: string; by?: string }) => `/analytics/cost?${q}&basis=${o.basis ?? basis}&by=${o.by ?? dim}`;
  const what = basis === "po" ? "purchase orders" : "invoices";
  const cosrRows = cosr.rows.filter((r) => r.serviceEgp > 0 || (r.acquisitionEgp ?? 0) > 0).sort((a, b) => (b.cosrYear ?? -1) - (a.cosrYear ?? -1));
  const cosrLink = `/reports/service-cost?from=${f.from}&to=${f.to}${f.facilityId ? `&facilityId=${f.facilityId}` : ""}`;
  const cosrTotal = typeof cosr.total?.cosrYear === "number" ? cosr.total.cosrYear : null;

  return (
    <>
      <AnalyticsFilters filters={f} />
      <TabLinks active={basis} tabs={[
        { key: "po", label: "Ordered (purchase orders)", href: link({ basis: "po" }) },
        { key: "invoice", label: "Invoiced", href: link({ basis: "invoice" }) },
      ]} />

      <KpiGrid>
        <KpiCard period={period} kpi={{ label: basis === "po" ? "Spend ordered" : "Spend invoiced", value: total, unit: "egp", n: lineCount,
          formula: basis === "po" ? "Sum of quantity × unit price on approved and issued orders, in EGP at the rate on the order date" : "Sum of invoice lines (not rejected), in EGP at the rate on the invoice date" }} />
        <KpiCard period={period} kpi={{ label: "Suppliers paid", value: suppliers.length, unit: "number", n: suppliers.length, formula: `Suppliers with ${what} in the period` }} />
        <KpiCard period={period} kpi={{ label: "Top 3 suppliers' share", value: topShare(suppliers, 3), unit: "share", n: suppliers.length, formula: "Spend with the 3 largest suppliers ÷ all spend" }} />
        <KpiCard period={period} kpi={{ label: "COSR per year", value: cosrTotal == null ? null : cosrTotal / 100, unit: "share", n: cosr.rows.reduce((s, r) => s + r.devices, 0),
          formula: "Service cost ÷ purchase cost of the same devices, scaled to 12 months", benchmark: { text: "under about 5–6 % a year", source: "COSR guide in the service cost report" } }} />
      </KpiGrid>

      {spend.missing.length > 0 && <p className="mb-4 text-sm text-warn">No exchange rate stored for {spend.missing.join(", ")}: those amounts are left out of the EGP totals.</p>}
      {spend.truncated && <p className="mb-4 text-sm text-warn">Too many records to show at once: pick a shorter period or one hospital.</p>}

      <div className="space-y-5">
        <Panel title={`Spend by ${SPEND_DIMS.find((d) => d.id === dim)!.label.toLowerCase()}`}
          actions={<TabLinks active={dim} tabs={SPEND_DIMS.map((d) => ({ key: d.id, label: d.label, href: link({ by: d.id }) }))} />}>
          {groups.length === 0 ? (
            <EmptyState title={`No ${what} in this period`}>Pick a longer period or another hospital in the filters above.</EmptyState>
          ) : (
            <div className="space-y-5">
              {dim !== "year" && <ShareStrip label={`Share of spend by ${dim}`} parts={shown.map((g) => ({ label: g.label, share: g.share }))} />}
              <BarList label={`Spend by ${dim} in EGP`} data={shown.map((g) => ({ label: g.label, value: g.egp, tone: g.key === "other" ? "muted" : "primary" }))}
                format={(n) => formatMoney(n, "EGP", { compact: true })} />
              <DataTable id={`spend-${dim}`} label={`Spend by ${dim}`} path="/analytics/cost" sp={sp} sort={null} rows={shown} rowKey={(g) => g.key}
                columns={[
                  { key: "label", label: SPEND_DIMS.find((d) => d.id === dim)!.label, cell: (g) => { const h = groupHref(dim, g); return h ? <Link href={h} className="text-primary hover:underline">{g.label}</Link> : g.label; } },
                  ...(dim === "currency" ? [{ key: "original", label: "In the currency", align: "right" as const, cell: (g: SpendGroup) => formatMoney(g.original ?? 0, g.key) }] : []),
                  { key: "egp", label: "Spend (EGP)", align: "right", cell: (g) => formatMoney(g.egp, "EGP") },
                  { key: "share", label: "Share", align: "right", cell: (g) => pct(g.share) },
                  { key: "lines", label: "Lines", align: "right", cell: (g) => formatNumber(g.lines) },
                ]} />
              {dim !== "year" && groups.length > shown.length && <p className="text-xs text-muted">The {TOP} largest are shown; the rest are added up as Other.</p>}
            </div>
          )}
        </Panel>

        <Panel title="Service cost against purchase value (COSR) by device type" actions={<Link href={cosrLink} className="text-sm font-semibold text-primary hover:underline">Open the full service cost report</Link>}>
          {cosrRows.length === 0 ? (
            <EmptyState title="No service cost or purchase cost recorded">Record purchase costs on devices and costs on completed jobs to see COSR.</EmptyState>
          ) : (
            <DataTable id="cosr" label="COSR by device type" path="/analytics/cost" sp={sp} sort={null} rows={cosrRows.slice(0, 25)} rowKey={(r) => r.type}
              columns={[
                { key: "type", label: "Device type", cell: (r) => r.typeCode ? <Link href={`/catalogue/${r.typeCode}`} className="text-primary hover:underline">{r.type}</Link> : r.type },
                { key: "devices", label: "Devices", align: "right", cell: (r) => formatNumber(r.devices) },
                { key: "acq", label: "Purchase cost (EGP)", align: "right", cell: (r) => formatMoney(r.acquisitionEgp, "EGP", { compact: true }) },
                { key: "svc", label: "Service cost (EGP)", align: "right", cell: (r) => formatMoney(r.serviceEgp, "EGP", { compact: true }) },
                { key: "cosr", label: "COSR per year", align: "right", cell: (r) => {
                  const t = cosrTone(r.cosrYear);
                  return <span className={t === "danger" ? "text-danger" : t === "warn" ? "text-warn" : t === "ok" ? "text-ok" : undefined}>{r.cosrYear == null ? "—" : `${formatNumber(r.cosrYear, 1)} %`}</span>;
                } },
              ]} />
          )}
          <p className="mt-3 text-xs text-muted">From the service cost report, for the hospital and period chosen (department and device type filters don&apos;t apply here). {COSR_NOTE}</p>
        </Panel>

        <p className="text-xs text-muted">
          Ordered: approved and issued purchase orders, by order date (issue date, else the day it was made). Invoiced: invoices not rejected, by invoice date.
          Each amount is in EGP at the exchange rate in force on its date. Category is the top level of the device type. Department is the one the order line is for.
        </p>
      </div>
    </>
  );
}

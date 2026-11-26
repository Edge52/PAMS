import { AnalyticsFilters } from "@/components/analytics/filters";
import { EmptyState, Panel, Table, Td, Th, THead } from "@/components/ui";
import { bestOf, METRICS } from "@/lib/analytics/compare";
import { compareHospitals } from "@/lib/analytics/compare-server";
import { MIN_N, parseFilters } from "@/lib/analytics/core";
import { formatKpiValue, NOT_ENOUGH } from "@/lib/analytics/format";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { seesPrices } from "@/lib/auth/prices";
import { requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: compare hospitals" };

/** The same figures for every hospital the user may see, per bed or per device (wave 40). */
export default async function CompareAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const today = todayISO();
  // Always every hospital the user may see: the hospital filter is ignored here.
  const f = { ...parseFilters(await searchParams, today), facilityId: null };
  const ids = await analyticsScope(me, f);
  const prices = seesPrices(me.role);
  const rows = await compareHospitals(ids, f, today, prices);
  const metrics = METRICS.filter((m) => prices || !m.prices);

  return (
    <>
      <AnalyticsFilters filters={f} />
      {rows.length < 2 && <p className="mb-4 text-sm text-muted">You can see one hospital, so there is nothing to compare it with. Its figures are below.</p>}
      {!rows.length ? <EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState> : (
        <Panel title={`${formatDate(f.from)} – ${formatDate(f.to)}`} padded={false}>
          <Table>
            <THead><tr><Th>Figure</Th>{rows.map((r) => <Th key={r.hospital.id} align="right">{r.hospital.name}</Th>)}<Th>How it is worked out</Th></tr></THead>
            <tbody>
              {metrics.map((m) => {
                const best = bestOf(rows.map((r) => r.kpis), m.id);
                return (
                  <tr key={m.id} className="border-b border-line last:border-0">
                    <Td className="font-semibold">{m.label}</Td>
                    {rows.map((r, i) => {
                      const k = r.kpis[m.id];
                      return (
                        <Td key={r.hospital.id} align="right">
                          {k == null ? "—" : k.value == null ? <span className="text-xs text-muted" title={NOT_ENOUGH}>n &lt; {MIN_N}</span>
                            : <span className={best === i ? "font-semibold text-ok" : ""}>{formatKpiValue(k)}</span>}
                          {k && <span className="block text-[11px] text-muted">n = {formatNumber(k.n)}</span>}
                        </Td>
                      );
                    })}
                    <Td className="text-xs text-muted">{m.formula}</Td>
                  </tr>
                );
              })}
              <tr><Td className="font-semibold">Beds</Td>{rows.map((r) => <Td key={r.hospital.id} align="right">{formatNumber(r.hospital.beds)}</Td>)}<Td className="text-xs text-muted">Hospital beds (Facilities)</Td></tr>
            </tbody>
          </Table>
        </Panel>
      )}
      <p className="mt-3 text-xs text-muted">
        Figures are per bed or per device so hospitals of different sizes compare fairly. A figure resting on fewer than {MIN_N} items is hidden (n &lt; {MIN_N}).
        The best value among hospitals is in green. PPM on time allows 7 days&apos; grace; uptime counts device hours down from work orders with downtime.
        {prices && " Spend per bed counts approved and paid invoices on orders of that hospital (the department and device type filters do not apply to it)."}
      </p>
    </>
  );
}

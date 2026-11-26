import Link from "next/link";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { Badge, EmptyState, Panel, Table, Td, Th, THead } from "@/components/ui";
import { OVER_AT, UNDER_AT } from "@/lib/analytics/budget";
import { budgetAnalytics } from "@/lib/analytics/budget-server";
import { filterQuery, parseFilters } from "@/lib/analytics/core";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { requirePermission } from "@/lib/auth/session";
import { fiscalYearOptions } from "@/lib/fiscal-year";
import { formatMoney, formatNumber, todayISO } from "@/lib/format";
import { budgetYear } from "@/lib/procurement/budget-year-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: budget" };

const pct = (x: number | null) => (x == null ? "—" : `${formatNumber(x * 100, 0)} %`);
const egp = (n: number | null) => (n == null ? "—" : formatMoney(n, "EGP", { compact: true }));

/** Budget used so far and the year-end forecast per budget line (wave 40). */
export default async function BudgetAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("prices.view");
  const sp = await searchParams;
  const today = todayISO();
  const f = parseFilters(sp, today);
  const ids = await analyticsScope(me, f);
  const by = await budgetYear();
  const year = Number(sp.year) || by.current;
  const prefer = sp.method === "seasonal" ? "seasonal" : "straight";
  const a = await budgetAnalytics(ids, f, year, by.startMonth, today, prefer);
  const t = a.totals;
  const period = { from: a.range.start, to: a.range.end };
  const link = (y: number, m: string) => `/analytics/budget?${filterQuery(f)}&year=${y}&method=${m}`;

  return (
    <>
      <AnalyticsFilters filters={f} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Budget year:</span>
        {fiscalYearOptions(by.current, by.startMonth, [year]).map((o) => (
          <Link key={o.value} href={link(o.value, prefer)} aria-current={o.value === year ? "page" : undefined}
            className={o.value === year ? "font-semibold text-primary-strong" : "text-primary hover:underline"}>{o.label}</Link>
        ))}
        <span className="ml-3 text-muted">Forecast:</span>
        <Link href={link(year, "straight")} aria-current={prefer === "straight" ? "page" : undefined} className={prefer === "straight" ? "font-semibold text-primary-strong" : "text-primary hover:underline"}>Straight line</Link>
        <Link href={link(year, "seasonal")} aria-current={prefer === "seasonal" ? "page" : undefined} className={prefer === "seasonal" ? "font-semibold text-primary-strong" : "text-primary hover:underline"}>Seasonal</Link>
      </div>
      <p className="mb-4 text-sm text-muted">
        {by.label(year)}, {formatNumber(a.gone, 1)} of 12 months gone. The period filter does not apply here: budgets run by budget year.
        The device type filter does not apply either; the department filter keeps lines set to that department.
      </p>
      <KpiGrid>
        <KpiCard period={period} kpi={{ label: "Budget", value: t.amount, unit: "egp", formula: "Sum of the budget lines, EGP at today's rate", n: t.lines }} />
        <KpiCard period={period} kpi={{ label: "Used so far", value: t.usedPct, unit: "share", formula: "(Committed on orders + spent on invoices) ÷ budget", n: t.lines }} />
        <KpiCard period={period} kpi={{ label: "Year-end forecast", value: t.forecastPct, unit: "share", formula: prefer === "seasonal" ? "Seasonal forecast where last year has invoices, else straight line, ÷ budget" : "(Spent ÷ months gone × 12 + committed) ÷ budget", n: t.lines }}
          tone={t.forecastPct == null ? undefined : t.forecastPct > OVER_AT ? "danger" : t.forecastPct < UNDER_AT ? "warn" : "ok"} />
        <KpiCard period={period} kpi={{ label: "Lines to look at", value: t.over + t.under, unit: "number", formula: `Lines forecast over ${OVER_AT * 100} % or under ${UNDER_AT * 100} % of budget`, n: t.lines }} />
      </KpiGrid>
      {prefer === "seasonal" && !a.hasSeason && <p className="mb-4 text-sm text-warn">No invoices last budget year, so every line uses the straight line.</p>}
      {a.missing.length > 0 && <p className="mb-4 text-sm text-warn">No exchange rate for {a.missing.join(", ")}: those amounts are left out.</p>}
      {a.truncated && <p className="mb-4 text-sm text-warn">Only the first 500 lines are shown. Pick a hospital to narrow it down.</p>}
      {!a.rows.length ? (
        <EmptyState title={`No budget lines for ${by.label(year)}`}>Add budget lines under Procurement › Budgets, then come back.</EmptyState>
      ) : (
        <Panel title="Budget lines" padded={false}>
          <Table>
            <THead><tr><Th>Line</Th>{ids.length > 1 && <Th>Hospital</Th>}<Th>Kind</Th><Th align="right">Budget</Th><Th align="right">Committed</Th><Th align="right">Spent</Th><Th align="right">Used</Th><Th align="right">Straight line</Th><Th align="right">Seasonal</Th><Th align="right">Forecast</Th><Th>Flag</Th></tr></THead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <Td><Link className="text-primary hover:underline" href={`/procurement/budgets?facilityId=${r.facilityId}&year=${year}&line=${r.id}`}>{r.name}</Link>{r.currency !== "EGP" && <span className="ml-1 text-xs text-muted">({r.currency})</span>}</Td>
                  {ids.length > 1 && <Td>{r.facility}</Td>}
                  <Td>{r.kind === "CAPITAL" ? "Capital" : "Maintenance"}</Td>
                  <Td align="right">{egp(r.amount)}</Td><Td align="right">{egp(r.committed)}</Td><Td align="right">{egp(r.spent)}</Td>
                  <Td align="right">{pct(r.usedPct)}</Td><Td align="right">{egp(r.straight)}</Td><Td align="right">{egp(r.seasonal)}</Td>
                  <Td align="right">{pct(r.forecastPct)}</Td>
                  <Td>{r.flag === "over" ? <Badge tone="danger">Over budget</Badge> : r.flag === "under" ? <Badge tone="warn">Under 70 %</Badge> : r.flag === "ok" ? <Badge tone="ok">On track</Badge> : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
      <p className="mt-3 text-xs text-muted">
        Committed = approved orders not yet invoiced; spent = approved and paid invoices (as on Procurement › Budgets). Straight line = spent ÷ months gone × 12 + committed.
        Seasonal = spent ÷ the share of last year&apos;s spending that fell in the same months + committed (the same line by name, else all lines of that kind). A forecast never sits below what is already used.
      </p>
    </>
  );
}

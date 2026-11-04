import Link from "next/link";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, budgetLines, departments, deviceTypes, facilities, maintenanceEvents, serviceContractAssets, serviceContracts } from "@/db/schema";
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Stat } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { egpRates, toEgp } from "@/lib/assets/lifecycle-server";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatMoney, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance budget" };
const egp = (n: number) => formatMoney(n, "EGP", { compact: true });

/**
 * Maintenance budget (wave 12): what upkeep costs per department this year — completed maintenance and repairs, and
 * each service contract's share for the year split over the devices it covers — against maintenance budget lines,
 * with a full-year forecast at the pace so far.
 */
export default async function MaintenanceBudgetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Maintenance budget" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const now = new Date(), thisYear = now.getFullYear();
  const year = Number(sp.year) || thisYear;
  const y0 = `${year}-01-01`, y1 = `${year + 1}-01-01`;
  const elapsed = year < thisYear ? 1 : year > thisYear ? 0 : (now.getTime() - Date.parse(y0)) / (Date.parse(y1) - Date.parse(y0));

  const [rates, depts, events, contracts, lines, planned] = await Promise.all([
    egpRates(),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)),
    db.select({ assetId: maintenanceEvents.assetId, cost: maintenanceEvents.cost, currency: maintenanceEvents.currency, dept: assets.departmentId, tag: assets.assetTag, type: deviceTypes.name })
      .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, facilityId), eq(maintenanceEvents.status, "COMPLETED"), gte(maintenanceEvents.completedDate, y0), lt(maintenanceEvents.completedDate, y1))),
    db.select().from(serviceContracts).where(and(eq(serviceContracts.facilityId, facilityId), lt(serviceContracts.startDate, y1), gte(serviceContracts.endDate, y0))),
    db.select().from(budgetLines).where(and(eq(budgetLines.facilityId, facilityId), eq(budgetLines.year, year), eq(budgetLines.kind, "MAINTENANCE"))),
    db.select({ n: sql<number>`count(*)::int` }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(eq(assets.facilityId, facilityId), eq(maintenanceEvents.status, "SCHEDULED"), gte(maintenanceEvents.scheduledDate, now.toISOString().slice(0, 10)), lte(maintenanceEvents.scheduledDate, `${year}-12-31`))),
  ]);
  const covered = contracts.length ? await db.select({ contractId: serviceContractAssets.contractId, dept: assets.departmentId }).from(serviceContractAssets)
    .innerJoin(assets, eq(assets.id, serviceContractAssets.assetId)).where(inArray(serviceContractAssets.contractId, contracts.map((c) => c.id))) : [];
  const byDept = new Map<number | null, { work: number; contracts: number }>();
  const add = (d: number | null, k: "work" | "contracts", v: number) => { const x = byDept.get(d) ?? { work: 0, contracts: 0 }; x[k] += v; byDept.set(d, x); };
  for (const e of events) add(e.dept, "work", toEgp(rates, e.cost, e.currency));
  for (const c of contracts) {
    if (c.value == null) continue;
    const days = (Date.parse(c.endDate) - Date.parse(c.startDate)) / 864e5 + 1;
    const inYear = (Math.min(Date.parse(c.endDate) + 864e5, Date.parse(y1)) - Math.max(Date.parse(c.startDate), Date.parse(y0))) / 864e5;
    const share = toEgp(rates, c.value, c.currency) * Math.max(0, inYear) / days;
    const mine = covered.filter((x) => x.contractId === c.id);
    if (!mine.length) add(null, "contracts", share);
    else for (const x of mine) add(x.dept, "contracts", share / mine.length);
  }
  const deptName = (id: number | null) => (id == null ? "No department" : depts.find((d) => d.id === id)?.name ?? "—");
  const budgetOf = (d: number | null) => lines.filter((l) => l.departmentId === d).reduce((s, l) => s + toEgp(rates, l.amount, l.currency), 0);
  const hospitalBudget = budgetOf(null);
  // Work is forecast at the pace so far; contract shares are already the full year's.
  const rows = [...byDept.entries()].map(([d, v]) => ({ d, ...v, forecast: (elapsed ? v.work / elapsed : v.work) + v.contracts, budget: d == null ? 0 : budgetOf(d) }))
    .sort((a, b) => b.forecast - a.forecast);
  const totalForecast = rows.reduce((s, r) => s + r.forecast, 0), totalBudget = lines.reduce((s, l) => s + toEgp(rates, l.amount, l.currency), 0);
  const spent = rows.reduce((s, r) => s + r.work + r.contracts * elapsed, 0);
  const top = Object.values(events.reduce((m, e) => { const k = e.tag; m[k] = m[k] ?? { tag: e.tag, type: e.type, id: e.assetId, v: 0 }; m[k].v += toEgp(rates, e.cost, e.currency); return m; }, {} as Record<string, { tag: string; type: string; id: number; v: number }>)).sort((a, b) => b.v - a.v).slice(0, 10);

  return (
    <>
      <PageHeader title="Maintenance budget" back={{ href: "/assets/maintenance", label: "Maintenance" }} description="Upkeep per department: completed maintenance and repairs, plus each service contract's share for the year, against maintenance budget lines (set them under Procurement › Budgets, kind Maintenance)." />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Year"><NativeSelect name="year" value={year} options={[-2, -1, 0, 1].map((k) => thisYear + k).map((y) => ({ value: y, label: String(y) }))} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={year === thisYear ? "Spent so far" : "Spent"} value={egp(spent)} hint={year === thisYear ? `${Math.round(elapsed * 100)} % of the year gone` : undefined} />
        <Stat label="Full-year forecast" value={egp(totalForecast)} hint="At this year's pace, with contracts in full" />
        <Stat label="Maintenance budget" value={totalBudget ? egp(totalBudget) : "Not set"} hint={totalBudget ? (totalForecast > totalBudget ? `Forecast ${egp(totalForecast - totalBudget)} over` : `${egp(totalBudget - totalForecast)} to spare`) : undefined} />
        <Stat label="Planned visits left" value={formatNumber(planned[0].n)} hint="Scheduled PPM visits for the rest of the year" />
      </div>
      <Panel title="By department (EGP)" padded={false}>
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">No maintenance costs recorded for {year}.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">Department</th><th className="px-3 py-2 text-right">Maintenance and repairs</th><th className="px-3 py-2 text-right">Contracts (year)</th><th className="px-3 py-2 text-right">Forecast</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2">Against budget</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={String(r.d)} className="border-t border-line">
                <td className="px-3 py-2">{deptName(r.d)}</td><td className="px-3 py-2 text-right">{egp(r.work)}</td><td className="px-3 py-2 text-right">{egp(r.contracts)}</td>
                <td className="px-3 py-2 text-right font-semibold">{egp(r.forecast)}</td><td className="px-3 py-2 text-right">{r.budget ? egp(r.budget) : "—"}</td>
                <td className="px-3 py-2">{r.budget ? <Badge tone={r.forecast > r.budget ? "danger" : r.forecast > 0.9 * r.budget ? "warn" : "ok"}>{Math.round((r.forecast / r.budget) * 100)} %</Badge> : <span className="text-muted">{hospitalBudget ? "hospital-wide line" : "—"}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {top.length > 0 && (
        <Panel title="Most costly devices this year" className="mt-6">
          <ul className="space-y-1 text-sm">{top.map((t) => <li key={t.tag} className="flex justify-between gap-3"><span><Link href={`/assets/${t.id}`} className="font-mono text-primary hover:underline">{t.tag}</Link> <span className="text-muted">{t.type}</span></span><span>{egp(t.v)}</span></li>)}</ul>
        </Panel>
      )}
    </>
  );
}

import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, capitalBudgets, departments, deviceModels, deviceTypes, equipmentRequests, facilities } from "@/db/schema";
import { egpRates } from "@/lib/assets/lifecycle-server";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { BAND_LABEL } from "@/lib/assets/lifecycle-kpis";
import { replacementPlan } from "@/lib/assets/lifecycle-server";
import { plannedYear } from "@/lib/assets/planning";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatMoney, formatNumber, num } from "@/lib/format";
import { createReplacementBoqAction } from "../replacement/actions";
import { saveBudgetAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capital plan" };

const egp = (n: number) => formatMoney(n, "EGP", { compact: true });

/**
 * Capital plan (wave 9, D4): every device in use placed in the year it should be replaced — by its replacement score,
 * its life and the maker's end of support — costed per department and year against the budget, and turned into a BOQ.
 */
export default async function CapitalPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Capital plan" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const horizon = sp.years === "10" ? 10 : 5;
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: horizon }, (_, i) => thisYear + i);
  const pick = Number(sp.year) && years.includes(Number(sp.year)) ? Number(sp.year) : thisYear;

  const [plan, models, budgets, depts] = await Promise.all([
    replacementPlan(eq(assets.facilityId, facilityId)),
    db.select({ id: assets.id, eos: deviceModels.endOfSupport }).from(assets).innerJoin(deviceModels, and(eq(deviceModels.deviceTypeId, assets.deviceTypeId),
      sql`lower(trim(${assets.manufacturer})) = lower(${deviceModels.manufacturer}) and lower(trim(${assets.model})) = lower(${deviceModels.model})`))
      .where(and(eq(assets.facilityId, facilityId), sql`${deviceModels.endOfSupport} is not null`)),
    db.select().from(capitalBudgets).where(and(eq(capitalBudgets.facilityId, facilityId), inArray(capitalBudgets.year, years))),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)),
  ]);
  const eos = new Map(models.map((m) => [m.id, m.eos]));
  // Approved department requests (wave 12), costed from the device type's price range.
  const rates = await egpRates();
  const reqs = (await db.select({ r: equipmentRequests, typeName: deviceTypes.name, pmin: deviceTypes.priceMinUsd, pmax: deviceTypes.priceMaxUsd }).from(equipmentRequests)
    .innerJoin(deviceTypes, eq(deviceTypes.id, equipmentRequests.deviceTypeId)).where(and(eq(equipmentRequests.facilityId, facilityId), eq(equipmentRequests.status, "APPROVED"))))
    .filter((x) => x.r.planYear != null && years.includes(x.r.planYear))
    .map((x) => { const mid = x.pmin != null || x.pmax != null ? (num(x.pmin ?? x.pmax) + num(x.pmax ?? x.pmin)) / 2 : null; return { ...x, egp: mid != null ? mid * (rates.get("USD") ?? 0) * x.r.quantity : 0 }; });
  const placed = plan.map((r) => ({ ...r, eos: eos.get(r.id) ?? null, ...plannedYear({ band: r.score.band, installDate: r.installDate, lifeYears: r.lifeYears, endOfSupport: eos.get(r.id) ?? null }, thisYear) }))
    .filter((r) => r.year != null && r.year <= years[years.length - 1]);
  const deptName = (id: number | null) => (id == null ? "No department" : depts.find((d) => d.id === id)?.name ?? "—");
  const deptIds = [...new Set([...placed.map((r) => r.departmentId), ...reqs.map((x) => x.r.departmentId)])].sort((a, b) => deptName(a).localeCompare(deptName(b)));
  const cell = (dept: number | null | "all", y: number) => placed.filter((r) => r.year === y && (dept === "all" || r.departmentId === dept)).reduce((s, r) => s + (r.estimateEgp ?? 0), 0)
    + reqs.filter((x) => x.r.planYear === y && (dept === "all" || x.r.departmentId === dept)).reduce((s, x) => s + x.egp, 0);
  const budgetOf = (y: number) => { const b = budgets.find((x) => x.year === y); return b ? num(b.amount) : null; };
  const yearRows = placed.filter((r) => r.year === pick).sort((a, b) => b.score.score - a.score.score);
  const unpriced = placed.filter((r) => r.estimateEgp == null).length;
  const canBoq = can(me.role, "boq.edit");
  const fac = facs.find((f) => f.id === facilityId);
  const q = (y: number) => `/assets/capital-plan?facilityId=${facilityId}&years=${horizon}&year=${y}`;
  const total = years.reduce((s, y) => s + cell("all", y), 0);

  return (
    <>
      <PageHeader title="Capital plan" description="Each device in use placed in the year it should be replaced: now when it scores “replace now”, within two years when it scores “plan”, otherwise when its life ends — earlier if the maker stops supporting it." />
      <Notice sp={sp} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Horizon"><NativeSelect name="years" value={horizon} options={[{ value: 5, label: "5 years" }, { value: 10, label: "10 years" }]} /></Field>
        <Button variant="secondary">Show</Button>
        <Link href={`/assets/replacement?facilityId=${facilityId}`} className="ml-auto text-sm text-primary hover:underline">Replacement scores</Link>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${horizon}-year need`} value={egp(total)} hint={`${formatNumber(placed.length)} devices`} />
        <Stat label={`${thisYear}`} value={egp(cell("all", thisYear))} hint={budgetOf(thisYear) != null ? `Budget ${egp(budgetOf(thisYear)!)}` : "No budget set"} />
        <Stat label="Maker support ending" value={formatNumber(placed.filter((r) => r.why === "Maker support ends").length)} hint="Brought forward to the end of support" />
        <Stat label="Without a price" value={formatNumber(unpriced)} hint="Add a price range to their device type" />
      </div>
      <Panel title="Need by department and year (EGP)" padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-[13px]">
          <thead className="bg-sunken text-muted"><tr><th className="px-3 py-2 text-left font-semibold">Department</th>{years.map((y) => <th key={y} className="px-3 py-2 text-right font-semibold"><Link href={q(y)} className={y === pick ? "text-primary underline" : "hover:underline"}>{y}</Link></th>)}</tr></thead>
          <tbody>
            {deptIds.map((d) => (
              <tr key={String(d)} className="border-t border-line"><td className="px-3 py-1.5">{deptName(d)}</td>{years.map((y) => { const v = cell(d, y); return <td key={y} className="px-3 py-1.5 text-right">{v ? egp(v) : "—"}</td>; })}</tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold"><td className="px-3 py-1.5">Total</td>{years.map((y) => <td key={y} className="px-3 py-1.5 text-right">{egp(cell("all", y))}</td>)}</tr>
            <tr className="border-t border-line"><td className="px-3 py-1.5">Budget</td>{years.map((y) => <td key={y} className="px-3 py-1.5 text-right">{budgetOf(y) != null ? egp(budgetOf(y)!) : <span className="text-muted">—</span>}</td>)}</tr>
            <tr className="border-t border-line"><td className="px-3 py-1.5">Over (−) or under budget</td>{years.map((y) => { const b = budgetOf(y); if (b == null) return <td key={y} className="px-3 py-1.5 text-right text-muted">—</td>; const v = b - cell("all", y); return <td key={y} className={`px-3 py-1.5 text-right ${v < 0 ? "text-danger" : "text-ok"}`}>{v < 0 ? "−" : ""}{egp(Math.abs(v))}</td>; })}</tr>
          </tbody>
        </table></div>
      </Panel>
      {canBoq && (
        <Panel title="Budget" className="mt-6">
          <div className="flex flex-wrap gap-3">{years.map((y) => (
            <ActionForm key={y} action={saveBudgetAction} className="flex items-end gap-1.5">
              <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="year" value={y} />
              <Field label={`${y} (EGP)`}><Input name="amount" inputMode="numeric" defaultValue={budgetOf(y) ?? ""} className="w-36" /></Field>
              <Button variant="secondary">Save</Button>
            </ActionForm>
          ))}</div>
        </Panel>
      )}
      <ActionForm action={createReplacementBoqAction} className="mt-6">
        <Panel title={`${pick}: ${formatNumber(yearRows.length)} devices, ${egp(yearRows.reduce((s, r) => s + (r.estimateEgp ?? 0), 0))}`}
          actions={<span className="flex gap-2 text-sm">{years.map((y) => <Link key={y} href={q(y)} className={y === pick ? "font-semibold text-primary" : "text-muted hover:underline"}>{y}</Link>)}</span>}>
          {canBoq && yearRows.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <Field label="BOQ name" className="min-w-64 flex-1"><Input name="name" defaultValue={`${fac?.name ?? ""} — capital plan ${pick}`} maxLength={200} /></Field>
              <Button>Turn the ticked devices into a BOQ</Button>
            </div>
          )}
          {yearRows.length === 0 ? <p className="text-sm text-muted">Nothing planned for {pick}.</p> : (
            <Table>
              <THead><tr>{canBoq && <Th><span className="sr-only">Select</span></Th>}<Th>Device</Th><Th>Department</Th><Th>Why {pick}</Th><Th>Score</Th><Th align="right">Replacement</Th></tr></THead>
              <tbody>{yearRows.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  {canBoq && <Td><input type="checkbox" name="assetIds" value={r.id} defaultChecked aria-label={`Replace ${r.tag}`} /></Td>}
                  <Td><Link href={`/assets/${r.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{r.tag}</Link><div className="text-xs text-muted">{r.typeName}</div></Td>
                  <Td>{r.departmentName ?? "—"}</Td>
                  <Td>{r.why}{r.eos ? <div className="text-xs text-muted">support ends {r.eos}</div> : r.installDate && r.lifeYears ? <div className="text-xs text-muted">installed {r.installDate.slice(0, 4)}, {r.lifeYears}-year life</div> : null}</Td>
                  <Td><strong>{r.score.score}</strong> <Badge tone={r.score.band === "REPLACE" ? "danger" : r.score.band === "PLAN" ? "warn" : "ok"}>{BAND_LABEL[r.score.band]}</Badge></Td>
                  <Td align="right">{r.estimateEgp != null ? egp(r.estimateEgp) : "—"}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
          {yearRows.length > 300 && <p className="mt-2 text-sm text-muted">Showing the 300 highest scores of {formatNumber(yearRows.length)}.</p>}
          {reqs.some((x) => x.r.planYear === pick) && (
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <p className="mb-1 font-semibold">Approved department requests for {pick}</p>
              <ul className="space-y-0.5">{reqs.filter((x) => x.r.planYear === pick).map((x) => <li key={x.r.id}>{x.r.number}: {x.r.quantity} × {x.typeName} <span className="text-muted">· {deptName(x.r.departmentId)} · about {egp(x.egp)}</span></li>)}</ul>
              <Link href={`/assets/requests?facilityId=${facilityId}&tab=APPROVED`} className="text-primary hover:underline">Turn requests into a BOQ</Link>
            </div>
          )}
        </Panel>
      </ActionForm>
    </>
  );
}

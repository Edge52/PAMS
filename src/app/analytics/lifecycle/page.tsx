import Link from "next/link";
import { AnalyticsFilters } from "@/components/analytics/filters";
import { KpiCard, KpiGrid } from "@/components/analytics/kpi";
import { ActionForm } from "@/components/assets/action-form";
import { Badge, Button, EmptyState, Field, Input, Panel, Table, Td, Th, THead } from "@/components/ui";
import { Columns } from "@/components/ui/charts";
import { cleanSettings, DEFAULT_SETTINGS, HORIZON_YEARS, planCapital, replacementWave } from "@/lib/analytics/capital-whatif";
import { filterQuery, parseFilters } from "@/lib/analytics/core";
import { planDevices, scenariosFor } from "@/lib/analytics/lifecycle-server";
import { analyticsScope } from "@/lib/analytics/scope-server";
import { seesPrices } from "@/lib/auth/prices";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { fiscalYearRange } from "@/lib/fiscal-year";
import { formatMoney, formatNumber, todayISO } from "@/lib/format";
import { budgetYear } from "@/lib/procurement/budget-year-server";
import { deleteScenarioAction, saveScenarioAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics: lifecycle" };

const egp = (n: number | null) => (n == null ? "—" : formatMoney(n, "EGP", { compact: true }));
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Replacement wave over ten budget years and a capital what-if under a yearly budget cap (wave 40). */
export default async function LifecycleAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("reports.view");
  const sp = await searchParams;
  const today = todayISO();
  const f = parseFilters(sp, today);
  const ids = await analyticsScope(me, f);
  const by = await budgetYear();
  const thisYear = by.current;
  const prices = seesPrices(me.role);
  const [devices, scenarios] = await Promise.all([planDevices(ids, f, thisYear), prices ? scenariosFor(ids) : Promise.resolve([])]);
  const wave = replacementWave(devices, thisYear, HORIZON_YEARS);
  const range = { from: fiscalYearRange(thisYear, by.startMonth)!.start, to: fiscalYearRange(thisYear + HORIZON_YEARS - 1, by.startMonth)!.end };
  const due = wave.reduce((s, y) => s + y.devices, 0);
  const dueNow = wave[0]?.devices ?? 0;

  // The what-if: a saved scenario, then anything typed in the form on top.
  const picked = scenarios.find((s) => s.id === Number(one(sp.scenario)));
  const typed = one(sp.run) != null;
  const settings = typed ? cleanSettings({ delayYears: one(sp.delayYears), budgetPerYear: one(sp.budgetPerYear), includeTypes: one(sp.includeTypes) }) : picked?.settings ?? DEFAULT_SETTINGS;
  const plan = prices ? planCapital(devices, settings, thisYear, HORIZON_YEARS) : null;
  const canSave = prices && can(me.role, "boq.edit") && f.facilityId != null;
  const base = `/analytics/lifecycle?${filterQuery(f)}`;

  return (
    <>
      <AnalyticsFilters filters={f} />
      <KpiGrid>
        <KpiCard period={range} kpi={{ label: "Due in ten years", value: due, unit: "number", formula: "Devices in use whose planned replacement falls in the next ten budget years", n: devices.length }} />
        <KpiCard period={range} kpi={{ label: `Due in ${by.label(thisYear)}`, value: dueNow, unit: "number", formula: "Scores \"replace now\", or life or maker support already ended", n: devices.length }} />
        {prices && <KpiCard period={range} kpi={{ label: "Ten-year cost", value: wave.reduce((s, y) => s + y.cost, 0), unit: "egp", formula: "Replacement estimates (type price range at today's USD rate, else the purchase cost)", n: due - wave.reduce((s, y) => s + y.unpriced, 0) }} />}
        {plan && settings.budgetPerYear != null && <KpiCard period={range} kpi={{ label: "Left waiting after ten years", value: plan.leftAtEnd, unit: "number", formula: "Devices due within ten years still not replaced under the budget cap", n: plan.devices.length }} tone={plan.leftAtEnd ? "warn" : "ok"} />}
      </KpiGrid>

      <Panel title="Replacement wave">
        {!due ? <p className="text-sm text-muted">No device in this selection is due for replacement in the next ten years, or the register has no install dates and life years.</p> : (
          <>
            <Columns label="Devices due per budget year" data={wave.map((y) => ({ label: by.label(y.year).replace("FY ", ""), value: y.devices, tone: y.year === thisYear ? "warn" : "primary" }))} />
            <Table className="mt-4">
              <THead><tr><Th>Budget year</Th><Th align="right">Devices due</Th>{prices && <Th align="right">Estimated cost</Th>}{prices && <Th align="right">No price</Th>}</tr></THead>
              <tbody>{wave.map((y) => (
                <tr key={y.year} className="border-b border-line last:border-0"><Td>{by.label(y.year)}</Td><Td align="right">{y.devices}</Td>
                  {prices && <Td align="right">{egp(y.cost)}</Td>}{prices && <Td align="right">{y.unpriced || ""}</Td>}</tr>
              ))}</tbody>
            </Table>
            <p className="mt-2 text-xs text-muted">Due year as on the <Link className="text-primary hover:underline" href="/assets/capital-plan">capital plan</Link>: the replacement score, the end of the device&apos;s life and the maker&apos;s end of support. Devices already overdue count in {by.label(thisYear)}.</p>
          </>
        )}
      </Panel>

      <div className="mt-5" />
      <Panel title="Capital what-if">
        {!prices ? <p className="text-sm text-muted">The what-if uses replacement costs, so it is only for people who may see prices.</p> : (
          <>
            {scenarios.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Saved:</span>
                {scenarios.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1">
                    <Link href={`${base}&scenario=${s.id}`} aria-current={picked?.id === s.id && !typed ? "page" : undefined} className={picked?.id === s.id && !typed ? "font-semibold text-primary-strong" : "text-primary hover:underline"}>{s.name}</Link>
                    {can(me.role, "boq.edit") && (
                      <ActionForm action={deleteScenarioAction} confirm={`Delete the scenario "${s.name}"?`} tone="danger" confirmLabel="Delete scenario" className="inline">
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="inline-flex size-6 items-center justify-center text-xs text-muted hover:text-danger" aria-label={`Delete ${s.name}`}>×</button>
                      </ActionForm>
                    )}
                  </span>
                ))}
              </div>
            )}
            <form className="no-print flex flex-wrap items-end gap-3" aria-label="What-if settings">
              {Object.entries({ facilityId: f.facilityId, departmentId: f.departmentId, deviceTypeId: f.deviceTypeId, from: f.from, to: f.to }).map(([k, v]) => v != null && <input key={k} type="hidden" name={k} value={String(v)} />)}
              <input type="hidden" name="run" value="1" />
              <Field label="Delay (years)"><Input type="number" name="delayYears" min={0} max={10} defaultValue={settings.delayYears} className="w-24" /></Field>
              <Field label="Budget per year (EGP)" hint="Empty = no cap"><Input name="budgetPerYear" inputMode="numeric" defaultValue={settings.budgetPerYear ?? ""} className="w-44" /></Field>
              <Field label="Only these type codes" hint="e.g. IMG, IMG-CT; empty = all"><Input name="includeTypes" defaultValue={settings.includeTypes.join(", ")} className="w-56" /></Field>
              <Button variant="secondary">Run what-if</Button>
            </form>
            {canSave ? (
              <ActionForm action={saveScenarioAction} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="facilityId" value={f.facilityId!} />
                <input type="hidden" name="delayYears" value={settings.delayYears} />
                <input type="hidden" name="budgetPerYear" value={settings.budgetPerYear ?? ""} />
                <input type="hidden" name="includeTypes" value={settings.includeTypes.join(",")} />
                <Field label="Save these settings as"><Input name="name" required maxLength={80} defaultValue={picked?.name ?? ""} placeholder="e.g. 20M a year" className="w-56" /></Field>
                <Button variant="secondary">Save scenario</Button>
              </ActionForm>
            ) : can(me.role, "boq.edit") && <p className="mt-3 text-xs text-muted">Pick one hospital in the filters to save a scenario.</p>}

            {plan && (
              <>
                <Table className="mt-4">
                  <THead><tr><Th>Budget year</Th><Th align="right">Budget</Th><Th align="right">Spent</Th><Th align="right">Replaced</Th><Th align="right">Became due</Th><Th align="right">Waiting at year end</Th><Th align="right">Cost waiting</Th></tr></THead>
                  <tbody>{plan.years.map((y) => (
                    <tr key={y.year} className="border-b border-line last:border-0">
                      <Td>{by.label(y.year)}</Td><Td align="right">{y.budget == null ? "No cap" : egp(y.budget)}</Td><Td align="right">{egp(y.spent)}</Td>
                      <Td align="right">{y.replaced}</Td><Td align="right">{y.becameDue}</Td><Td align="right">{y.backlog}</Td><Td align="right">{egp(y.backlogCost)}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
                {plan.tooCostly > 0 && <p className="mt-2 text-sm text-warn">{plan.tooCostly} device{plan.tooCostly === 1 ? " costs" : "s cost"} more than a whole year&apos;s budget and {plan.tooCostly === 1 ? "is" : "are"} never placed.</p>}
                <Table className="mt-4">
                  <THead><tr><Th>Device</Th><Th>Type</Th><Th align="right">Score</Th><Th>Due</Th><Th>Replaced</Th><Th align="right">Wait</Th><Th align="right">Cost</Th></tr></THead>
                  <tbody>{plan.devices.slice(0, 100).map((d) => (
                    <tr key={d.id} className="border-b border-line last:border-0">
                      <Td><Link className="font-mono text-primary hover:underline" href={`/assets/${d.id}`}>{d.tag}</Link></Td><Td>{d.typeName}</Td><Td align="right">{formatNumber(d.score)}</Td>
                      <Td>{by.label(d.fromYear)}</Td>
                      <Td>{d.replaceYear != null ? by.label(d.replaceYear) : d.reason === "too-costly" ? <Badge tone="danger">Over the cap</Badge> : <Badge tone="warn">After ten years</Badge>}</Td>
                      <Td align="right">{d.waitYears ? `${d.waitYears} y` : ""}</Td><Td align="right">{egp(d.cost)}</Td>
                    </tr>
                  ))}</tbody>
                </Table>
                {plan.devices.length > 100 && <p className="mt-2 text-xs text-muted">First 100 of {formatNumber(plan.devices.length)} devices. The Excel export has them all.</p>}
                <p className="mt-2 text-xs text-muted">Each year the devices that may be replaced queue by due year, then score; the queue is funded while the year&apos;s budget lasts, and cheaper devices further down fill what is left. Unused budget is not carried over.</p>
              </>
            )}
          </>
        )}
      </Panel>
      {!devices.length && <div className="mt-5"><EmptyState title="No devices to plan">Devices in use with an install date and a life in years appear here.</EmptyState></div>}
    </>
  );
}

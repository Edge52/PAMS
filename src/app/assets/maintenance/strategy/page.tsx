import Link from "next/link";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { Badge, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Select, Stat, TabLinks, Table, Td, Th, THead, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { SortTh } from "@/components/ui/sort-th";
import { Notice } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import { emNumber, FUNCTION_SCORES, INCLUDE_AT, MAINTENANCE_SCORES, PHYSICAL_SCORES, riskLevel, STRATEGIES, STRATEGY_HINTS, STRATEGY_LABELS, strategyProblems, suggestedIntervalMonths } from "@/lib/assets/risk";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { parseSort, sortRows } from "@/lib/list";
import { saveRiskAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Risk and strategy" };

const TABS = ["todo", "all"] as const;
const LEVEL_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;
const LEVEL_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/**
 * Risk score and maintenance strategy per device type (wave 23): the hospital's written reason for how each type of
 * device is maintained. Lists the types it actually owns.
 */
export default async function StrategyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "todo";
  const mayEdit = can(me.role, "catalogue.edit");
  const types = await db.select({ t: deviceTypes, n: sql<number>`count(${assets.id})::int` }).from(deviceTypes)
    .innerJoin(assets, and(eq(assets.deviceTypeId, deviceTypes.id), ne(assets.status, "DISPOSED"), scopeWhere(assets.facilityId, scope)))
    .groupBy(deviceTypes.id).orderBy(deviceTypes.name);
  const all = types.map(({ t, n }) => ({ t, n, em: emNumber(t), problems: strategyProblems(t) }));
  const todo = all.filter((r) => r.problems.length > 0);
  const sort = parseSort(sp, ["type", "devices", "score", "strategy", "interval"] as const);
  const rows = sortRows(tab === "todo" ? todo : all, sort, { type: (r) => r.t.name, devices: (r) => r.n, score: (r) => r.em, strategy: (r) => r.t.maintenanceStrategy, interval: (r) => r.t.ppmIntervalMonths });
  const editing = mayEdit ? all.find((r) => r.t.id === Number(sp.edit)) ?? null : null;
  const q = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, sort: sort?.key, dir: sort?.dir === "desc" ? "desc" : undefined, ...over })) if (v !== undefined) p.set(k, String(v));
    return `/assets/maintenance/strategy?${p}`;
  };
  const scored = all.filter((r) => r.em != null).length, inProgramme = all.filter((r) => (r.em ?? 0) >= INCLUDE_AT).length;

  return (
    <>
      <PageHeader title="Risk and strategy" back={{ href: "/assets/maintenance", label: "Planned maintenance" }}
        description={`How each type of device the hospital owns is maintained, and why. The score adds equipment function (2 to 10), physical risk (1 to 5) and maintenance need (1 to 5); ${INCLUDE_AT} or more belongs in the planned maintenance programme.`} />
      <Notice sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Device types owned" value={all.length} />
        <Stat label="Scored" value={`${scored} of ${all.length}`} />
        <Stat label={`Score ${INCLUDE_AT} or more`} value={inProgramme} hint="In the planned programme" />
        <Stat label="Need attention" value={todo.length} href={q({ tab: "todo", edit: undefined })} hint="Not scored, no reason, or inconsistent" />
      </div>
      {editing && (
        <Panel title={<span id="risk-form">Risk and strategy: {editing.t.name}</span>} className="mb-6">
          <ActionForm action={saveRiskAction} className="space-y-5">
            <input type="hidden" name="id" value={editing.t.id} /><input type="hidden" name="back" value={q({ edit: undefined })} />
            <FormGrid cols={3}>
              <Field label="Equipment function"><Select name="riskFunction" defaultValue={editing.t.riskFunction ?? ""} placeholder="Choose…" options={FUNCTION_SCORES.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}` }))} /></Field>
              <Field label="Physical risk"><Select name="riskPhysical" defaultValue={editing.t.riskPhysical ?? ""} placeholder="Choose…" options={PHYSICAL_SCORES.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}` }))} /></Field>
              <Field label="Maintenance need"><Select name="riskMaintenance" defaultValue={editing.t.riskMaintenance ?? ""} placeholder="Choose…" options={MAINTENANCE_SCORES.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}` }))} /></Field>
            </FormGrid>
            <FormGrid cols={2}>
              <Field label="Maintenance strategy" hint={STRATEGIES.map((s) => `${STRATEGY_LABELS[s]}: ${STRATEGY_HINTS[s]}`).join(" ")}>
                <Select name="maintenanceStrategy" defaultValue={editing.t.maintenanceStrategy ?? ""} placeholder="Choose…" options={STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABELS[s] }))} />
              </Field>
              <Field label="Months between planned visits" hint={`Leave empty for repair when it fails.${suggestedIntervalMonths(editing.t.riskMaintenance) ? ` Its maintenance need suggests ${suggestedIntervalMonths(editing.t.riskMaintenance)}.` : ""}`}>
                <Input name="ppmIntervalMonths" inputMode="numeric" defaultValue={editing.t.ppmIntervalMonths ?? ""} />
              </Field>
            </FormGrid>
            <Field label="Reason for the strategy" hint="For example: the maker requires six-monthly calibration; or 5 years of records show no failure found at planned visits.">
              <Textarea name="strategyReason" rows={3} defaultValue={editing.t.strategyReason ?? ""} maxLength={1000} />
            </Field>
            <div className="flex gap-2"><SubmitButton pendingLabel="Saving…">Save</SubmitButton><LinkButton href={q({ edit: undefined })} variant="ghost">Cancel</LinkButton></div>
          </ActionForm>
        </Panel>
      )}
      <TabLinks active={tab} tabs={[{ key: "todo", label: `Need attention (${todo.length})`, href: q({ tab: "todo", edit: undefined }) }, { key: "all", label: `All types (${all.length})`, href: q({ tab: "all", edit: undefined }) }]} />
      {rows.length === 0 ? (
        <EmptyState title={all.length === 0 ? "No devices in the register yet" : "Every type is scored, with a strategy and a reason"}>
          {all.length === 0 ? "Device types appear here once the hospital has devices of that type." : "Nothing needs attention."}
        </EmptyState>
      ) : (
        <Table>
          <THead><tr><SortTh k="type">Device type</SortTh><SortTh k="devices" align="right">Devices</SortTh><SortTh k="score">Risk score</SortTh><SortTh k="strategy">Strategy</SortTh><SortTh k="interval">Interval</SortTh><Th>Reason, or what is missing</Th>{mayEdit && <Th><span className="sr-only">Edit</span></Th>}</tr></THead>
          <tbody>
            {rows.map(({ t, n, em, problems }) => {
              const level = riskLevel(em);
              return (
                <tr key={t.id} className={editing?.t.id === t.id ? "bg-primary-soft/40" : undefined}>
                  <Td><Link href={`/catalogue/${t.code}`} className="font-semibold text-primary hover:underline">{t.name}</Link><span className="block font-mono text-xs text-muted">{t.code}</span></Td>
                  <Td align="right">{n}</Td>
                  <Td>{em == null ? <span className="text-sm text-muted">Not scored</span> : <><span className="font-display text-xl">{em}</span> {level && <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>}<span className="block text-xs text-muted">{t.riskFunction} + {t.riskPhysical} + {t.riskMaintenance}</span></>}</Td>
                  <Td>{t.maintenanceStrategy ? STRATEGY_LABELS[t.maintenanceStrategy] : <span className="text-sm text-muted">Not chosen</span>}</Td>
                  <Td className="whitespace-nowrap">{t.ppmIntervalMonths ? `${t.ppmIntervalMonths} months` : "—"}</Td>
                  <Td className="max-w-md">{problems.length > 0 ? <ul className="text-sm text-warn">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : <span className="text-sm">{t.strategyReason}</span>}</Td>
                  {mayEdit && <Td><Link href={`${q({ edit: t.id })}#risk-form`} className="text-sm font-semibold text-primary hover:underline">{em == null ? "Score" : "Edit"}</Link></Td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <Panel title="Where the score comes from" className="mt-6">
        <p className="text-sm text-muted">The score is the equipment management number of Fennigkoh and Smith, the method most hospital equipment programmes start from. AAMI EQ89 asks that the strategy chosen for each type, and the reason, be written down. The score is a starting point: a maker&apos;s requirement, or the hospital&apos;s own failure history, can justify a different choice, and that is what the reason is for.</p>
      </Panel>
    </>
  );
}

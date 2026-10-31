import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, facilities } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat, Table, Td, Th, THead } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { BAND_LABEL, type ReplacementBand } from "@/lib/assets/lifecycle-kpis";
import { replacementPlan } from "@/lib/assets/lifecycle-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatMoney, formatNumber, todayISO } from "@/lib/format";
import { createReplacementBoqAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Replacement plan" };

const TONE: Record<ReplacementBand, "danger" | "warn" | "ok"> = { REPLACE: "danger", PLAN: "warn", KEEP: "ok" };
const SHOW = 150;

export default async function ReplacementPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) || undefined; };
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(one("facilityId")) || undefined) ?? facs[0]?.id;
  const deptId = Number(one("departmentId")) || undefined;
  const band = (["REPLACE", "PLAN", "KEEP", "DUE", "ALL"] as const).find((b) => b === one("band")) ?? "DUE";
  if (!facilityId) return <><PageHeader title="Replacement plan" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;

  const [all, depts] = await Promise.all([
    replacementPlan(and(eq(assets.facilityId, facilityId), deptId ? eq(assets.departmentId, deptId) : undefined)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
  ]);
  const count = (b: ReplacementBand) => all.filter((r) => r.score.band === b);
  const cost = (rows: typeof all) => rows.reduce((s, r) => s + (r.estimateEgp ?? 0), 0);
  const rows = all.filter((r) => band === "ALL" || (band === "DUE" ? r.score.band !== "KEEP" : r.score.band === band));
  const shown = rows.slice(0, SHOW);
  const canBoq = can(me.role, "boq.edit");
  const fac = facs.find((f) => f.id === facilityId);
  const link = (b: string) => `/assets/replacement?facilityId=${facilityId}${deptId ? `&departmentId=${deptId}` : ""}&band=${b}`;

  return (
    <>
      <PageHeader title="Replacement plan" description="Every device in use scored 0–100 for replacement: life used, repair cost against its price, failures, downtime, criticality, condition and open recalls."
        actions={can(me.role, "assets.dispose") && <Link href="/assets/disposals" className="text-sm font-semibold text-primary hover:underline">Disposals</Link>} />
      <Notice sp={sp} />
      <form action="/assets/replacement" className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Department"><NativeSelect name="departmentId" value={deptId} placeholder="All departments" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Field label="Show"><NativeSelect name="band" value={band} options={[{ value: "DUE", label: "Replace now and plan" }, { value: "REPLACE", label: "Replace now" }, { value: "PLAN", label: "Plan replacement" }, { value: "KEEP", label: "Keep" }, { value: "ALL", label: "Everything" }]} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Replace now" value={formatNumber(count("REPLACE").length)} hint={`About ${formatMoney(cost(count("REPLACE")), "EGP", { compact: true })}`} href={link("REPLACE")} />
        <Stat label="Plan replacement" value={formatNumber(count("PLAN").length)} hint={`About ${formatMoney(cost(count("PLAN")), "EGP", { compact: true })}`} href={link("PLAN")} />
        <Stat label="Keep" value={formatNumber(count("KEEP").length)} href={link("KEEP")} />
        <Stat label="Devices scored" value={formatNumber(all.length)} hint="In use, not in stock" />
      </div>

      {shown.length === 0 ? <EmptyState title="Nothing in this view">No device in {fac?.name ?? "this hospital"} falls in that band.</EmptyState> : (
        <ActionForm action={createReplacementBoqAction}>
          {canBoq && (
            <Panel title="Turn the ticked devices into a BOQ" className="mb-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="BOQ name" className="min-w-64 flex-1"><Input name="name" defaultValue={`${fac?.name ?? ""} — equipment replacement ${todayISO().slice(0, 4)}`} maxLength={200} /></Field>
                <Button>Create replacement BOQ</Button>
              </div>
              <p className="mt-2 text-xs text-muted">One line per department and device type, priced from the catalogue. &ldquo;Replace now&rdquo; devices are ticked for you; review and submit the BOQ for approval as usual.</p>
            </Panel>
          )}
          <Table>
            <THead><tr>{canBoq && <Th><span className="sr-only">Select</span></Th>}<Th>Device</Th><Th>Department</Th><Th align="right">Life used</Th><Th align="right">Failures (12 m)</Th><Th align="right">Down (12 m)</Th><Th align="right">Repairs ÷ price</Th><Th align="right">Replacement</Th><Th>Score</Th></tr></THead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                {canBoq && <Td><input type="checkbox" name="assetIds" value={r.id} defaultChecked={r.score.band === "REPLACE"} aria-label={`Replace ${r.tag}`} /></Td>}
                <Td><Link href={`/assets/${r.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{r.tag}</Link><div className="text-xs text-muted">{r.typeName}</div></Td>
                <Td>{r.departmentName ?? "—"}</Td>
                <Td align="right">{r.lifeUsedPct != null ? `${Math.round(r.lifeUsedPct)} %` : "—"}<div className="text-xs text-muted">{r.lifeYears ? `of ${r.lifeYears} y` : ""}</div></Td>
                <Td align="right">{r.failures12m || "—"}</Td>
                <Td align="right">{r.downtimeHours12m ? `${Math.round(r.downtimeHours12m / 24 * 10) / 10} d` : "—"}</Td>
                <Td align="right">{r.repairCostRatio != null ? `${Math.round(r.repairCostRatio * 100)} %` : "—"}</Td>
                <Td align="right" className="whitespace-nowrap">{r.estimateEgp != null ? formatMoney(r.estimateEgp, "EGP", { compact: true }) : "—"}</Td>
                <Td><span className="flex items-center gap-1"><strong>{r.score.score}</strong> <Badge tone={TONE[r.score.band]}>{BAND_LABEL[r.score.band]}</Badge></span>
                  {r.score.reasons.length > 0 && <div className="max-w-64 text-xs text-muted">{r.score.reasons.join(" · ")}</div>}</Td>
              </tr>
            ))}</tbody>
          </Table>
          {rows.length > SHOW && <p className="mt-2 text-sm text-muted">Showing the {SHOW} highest scores of {formatNumber(rows.length)}. Filter by department to see the rest.</p>}
        </ActionForm>
      )}
    </>
  );
}

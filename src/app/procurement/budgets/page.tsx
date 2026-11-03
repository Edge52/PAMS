import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, departments, facilities, projects, purchaseOrders, suppliers } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { CURRENCIES, formatMoney } from "@/lib/format";
import { budgetRows } from "@/lib/procurement/money-server";
import { saveBudgetLineAction } from "../invoices/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgets" };

const TONE = { OK: "ok", WARN: "warn", OVER: "danger" } as const;

/** Budgets and commitments (wave 10): each line's amount against POs committed and invoices spent. */
export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("procurement.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Budgets" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const year = Number(sp.year) || new Date().getFullYear();
  const [lines, depts, projs] = await Promise.all([
    db.select().from(budgetLines).where(and(eq(budgetLines.facilityId, facilityId), eq(budgetLines.year, year))).orderBy(asc(budgetLines.name)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name)),
    db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects).where(eq(projects.facilityId, facilityId)).orderBy(asc(projects.code)),
  ]);
  const rows = await budgetRows(lines);
  const open = Number(sp.line) || null;
  const pos = open ? await db.select({ id: purchaseOrders.id, number: purchaseOrders.number, status: purchaseOrders.status, supplier: suppliers.name }).from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.budgetLineId, open)) : [];
  const canEdit = can(me.role, "budgets.edit");
  const byCur = new Map<string, { amount: number; used: number }>();
  for (const r of rows) { const t = byCur.get(r.currency) ?? { amount: 0, used: 0 }; t.amount += Number(r.amount); t.used += r.used; byCur.set(r.currency, t); }
  const q = (extra = "") => `/procurement/budgets?facilityId=${facilityId}&year=${year}${extra}`;
  const name = (id: number | null, list: { id: number; name?: string; code?: string }[]) => (id ? list.find((x) => x.id === id) : null);

  return (
    <>
      <PageHeader title="Budgets" description="Money set aside per year, against what purchase orders commit and approved invoices spend. Finance is told when a PO takes a line past 80 % or 100 %." />
      <Notice sp={sp} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Year"><NativeSelect name="year" value={year} options={[-1, 0, 1, 2].map((k) => new Date().getFullYear() + k).map((y) => ({ value: y, label: String(y) }))} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      {byCur.size > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...byCur].map(([c, t]) => <Stat key={c} label={`${year} budget (${c})`} value={formatMoney(t.amount, c, { compact: true })} hint={`${Math.round(t.amount ? t.used / t.amount * 100 : 0)} % committed or spent`} />)}
          <Stat label="Lines past 80 %" value={String(rows.filter((r) => r.level !== "OK").length)} hint={`of ${rows.length}`} />
        </div>
      )}
      <Panel title={`${year} budget lines`} padded={false}>
        {rows.length === 0 ? <p className="p-4 text-sm text-muted">No budget lines for {year} yet.{canEdit ? " Add one below." : ""}</p> : (
          <ul className="divide-y divide-line">{rows.map((r) => {
            const pct = (x: number) => `${Math.min(100, Number(r.amount) > 0 ? (x / Number(r.amount)) * 100 : 0)}%`;
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span><Link href={q(`&line=${r.id}`)} className="font-semibold text-primary hover:underline">{r.name}</Link>
                    <span className="text-muted"> {[name(r.departmentId, depts)?.name, name(r.projectId, projs)?.code].filter(Boolean).join(" · ")}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={TONE[r.level]}>{Number.isFinite(r.pct) ? `${Math.round(r.pct * 100)} %` : "no budget"}</Badge><b>{formatMoney(r.amount, r.currency)}</b></span>
                </div>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                  <span className="bg-primary" style={{ width: pct(r.spent) }} /><span className="bg-info" style={{ width: pct(r.committed) }} /><span className="bg-warn/50" style={{ width: pct(r.requested) }} />
                </div>
                <p className="mt-1 text-xs text-muted">Spent {formatMoney(r.spent, r.currency)} · committed {formatMoney(r.committed, r.currency)} · waiting for approval {formatMoney(r.requested, r.currency)} · {r.remaining >= 0 ? `${formatMoney(r.remaining, r.currency)} left` : <span className="text-danger">{formatMoney(-r.remaining, r.currency)} over</span>} · {r.pos} PO{r.pos === 1 ? "" : "s"}{r.missingRate ? " · some POs have no exchange rate" : ""}</p>
                {open === r.id && (pos.length ? <ul className="mt-2 space-y-0.5 text-xs">{pos.map((p) => <li key={p.id}><Link href={`/procurement/purchase-orders/${p.id}`} className="font-mono text-primary hover:underline">{p.number}</Link> {p.supplier} · {p.status.toLowerCase().replace(/_/g, " ")}</li>)}</ul> : <p className="mt-2 text-xs text-muted">No PO charged to it yet. Charge one from the PO&apos;s page.</p>)}
              </li>
            );
          })}</ul>
        )}
      </Panel>
      {canEdit && (
        <Panel title="Add a budget line" className="mt-6">
          <ActionForm action={saveBudgetLineAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="year" value={year} />
            <Field label="Name"><Input name="name" required maxLength={200} placeholder="e.g. Imaging equipment" /></Field>
            <Field label="Amount"><Input name="amount" required inputMode="decimal" /></Field>
            <Field label="Currency"><NativeSelect name="currency" value="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="Department (optional)"><NativeSelect name="departmentId" placeholder="Whole hospital" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Project (optional)"><NativeSelect name="projectId" placeholder="Any project" options={projs.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` }))} /></Field>
            <div className="flex items-end"><Button>Add budget line</Button></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}

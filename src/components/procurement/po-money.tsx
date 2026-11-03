/** Budget and invoices on a purchase order's page (wave 10). Server component. */
import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { budgetLines, invoiceLines, invoices, purchaseOrders } from "@/db/schema";
import { Badge, Button, LinkButton, Panel, StatusBadge } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/format";
import { budgetRows } from "@/lib/procurement/money-server";
import { setPoBudgetAction } from "@/app/procurement/invoices/actions";

export async function PoMoney({ po, me }: { po: typeof purchaseOrders.$inferSelect; me: CurrentUser }) {
  const year = new Date().getFullYear();
  const [lines, invs] = await Promise.all([
    po.facilityId ? db.select().from(budgetLines).where(and(eq(budgetLines.facilityId, po.facilityId), sql`${budgetLines.year} between ${year - 1} and ${year + 1}`)).orderBy(desc(budgetLines.year), budgetLines.name) : Promise.resolve([]),
    db.select({ i: invoices, total: sql<string>`(select sum(${invoiceLines.quantity} * ${invoiceLines.unitPrice}) from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id})` })
      .from(invoices).where(eq(invoices.poId, po.id)).orderBy(desc(invoices.invoiceDate)),
  ]);
  const current = po.budgetLineId ? (await budgetRows(lines.filter((l) => l.id === po.budgetLineId)))[0] ?? null : null;
  const canBudget = can(me.role, "po.create") && po.status !== "CANCELLED";
  const canInvoice = can(me.role, "invoices.edit") && !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(po.status);
  return (
    <>
      <Panel title="Budget">
        {current ? (
          <p className="mb-3 text-sm"><b>{current.year} {current.name}</b>{" "}<Badge tone={current.level === "OK" ? "ok" : current.level === "WARN" ? "warn" : "danger"}>{Math.round(current.pct * 100)} % used</Badge><br />
            <span className="text-muted">{current.remaining >= 0 ? `${formatMoney(current.remaining, current.currency)} left` : `${formatMoney(-current.remaining, current.currency)} over`} of {formatMoney(current.amount, current.currency)}. </span>
            <Link href={`/procurement/budgets?facilityId=${current.facilityId}&year=${current.year}&line=${current.id}`} className="text-primary hover:underline">Budget</Link></p>
        ) : <p className="mb-3 text-sm text-muted">Not charged to a budget line.</p>}
        {canBudget && (lines.length ? (
          <ActionForm action={setPoBudgetAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="poId" value={po.id} />
            <NativeSelect name="budgetLineId" value={po.budgetLineId} placeholder="No budget line" aria-label="Budget line" options={lines.map((l) => ({ value: l.id, label: `${l.year} — ${l.name}` }))} />
            <Button variant="secondary">Charge</Button>
          </ActionForm>
        ) : <p className="text-xs text-muted">No budget lines for this hospital yet. <Link href="/procurement/budgets" className="text-primary hover:underline">Budgets</Link></p>)}
      </Panel>
      <Panel title={<span className="flex items-center gap-2">Invoices <Badge>{invs.length}</Badge></span>} actions={canInvoice ? <LinkButton href={`/procurement/invoices/new?poId=${po.id}`}>Record invoice</LinkButton> : null}>
        {invs.length === 0 ? <p className="text-sm text-muted">{canInvoice ? "No invoice recorded yet." : "Invoices are recorded once the order is approved."}</p> : (
          <ul className="space-y-1.5 text-sm">{invs.map((r) => (
            <li key={r.i.id} className="flex flex-wrap items-center justify-between gap-2"><span><Link href={`/procurement/invoices/${r.i.id}`} className="font-mono text-primary hover:underline">{r.i.number}</Link> <span className="text-muted">{formatDate(r.i.invoiceDate)}</span></span>
              <span className="flex items-center gap-2">{formatMoney(r.total, r.i.currency)} <StatusBadge value={r.i.status} /></span></li>
          ))}</ul>
        )}
      </Panel>
    </>
  );
}

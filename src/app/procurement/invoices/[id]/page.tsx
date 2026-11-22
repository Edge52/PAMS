import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices, purchaseOrders, suppliers } from "@/db/schema";
import { Badge, Button, Details, Field, Input, PageHeader, Panel, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { Notice } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney, todayISO } from "@/lib/format";
import { invoiceDutyProblem, matchInvoice } from "@/lib/procurement/money";
import { matchLinesFor } from "@/lib/procurement/money-server";
import { decideInvoiceAction, markPaidAction, setInvoicePenaltyAction } from "../actions";
import { penaltyLeft } from "@/lib/procurement/delay-penalty";
import { poDelayPenalty } from "@/lib/procurement/penalty-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("prices.view"); // audit R9: offers, prices and invoices
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [row] = await db.select({ i: invoices, po: purchaseOrders, supplier: suppliers.name }).from(invoices).innerJoin(purchaseOrders, eq(purchaseOrders.id, invoices.poId))
    .innerJoin(suppliers, eq(suppliers.id, invoices.supplierId)).where(eq(invoices.id, id));
  if (!row) notFound();
  await requireFacilityAccess(row.po.facilityId, me);
  const { i, po } = row;
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  const match = matchInvoice((await matchLinesFor(po.id, new Map(lines.map((l) => [l.poLineId, { quantity: l.quantity, unitPrice: Number(l.unitPrice) }])), id)).filter((l) => l.quantity > 0));
  const canDecide = can(me.role, "invoices.approve");
  // S7: the action enforces it; here we only say why the form isn't offered.
  const decideBlock = invoiceDutyProblem("decide", i, me), payBlock = invoiceDutyProblem("pay", i, me);
  const waiting = i.status === "MATCHED" || i.status === "EXCEPTION";
  const cur = i.currency;
  // Wave 37: the order's late-delivery penalty, and what this invoice deducts.
  const penalty = await poDelayPenalty(po.id, { exceptInvoiceId: id });
  const deducted = i.delayPenalty == null ? 0 : Number(i.delayPenalty);
  const left = penalty ? penaltyLeft(penalty.amount, penalty.deducted) : 0;
  const mayDeduct = canDecide && ["RECEIVED", "MATCHED", "EXCEPTION"].includes(i.status) && (left > 0 || deducted > 0);
  return (
    <>
      <PageHeader back={{ href: "/procurement/invoices", label: "Invoices" }} title={<span className="flex flex-wrap items-center gap-2">{i.number} <StatusBadge value={i.status} /></span>}
        description={<>{row.supplier}&apos;s invoice {i.supplierInvoiceNo} against <Link href={`/procurement/purchase-orders/${po.id}`} className="text-primary hover:underline">{po.number}</Link></>} />
      <Notice sp={await searchParams} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Panel title="Three-way match: ordered, received, invoiced" padded={false}
            actions={waiting ? (match.ok ? <Badge tone="ok">Matches</Badge> : <Badge tone="danger">Differences</Badge>) : null}>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Invoiced (with this)</th><th className="px-3 py-2 text-right">PO price</th><th className="px-3 py-2 text-right">Invoice price</th><th className="px-3 py-2">Check</th></tr></thead>
              <tbody>{match.lines.map((l) => (
                <tr key={l.poLineId} className="border-t border-line align-top">
                  <td className="px-3 py-2">{l.description}</td><td className="px-3 py-2 text-right">{l.ordered}</td><td className="px-3 py-2 text-right">{l.received}</td>
                  <td className="px-3 py-2 text-right">{l.invoicedBefore + l.quantity}<div className="text-xs text-muted">{l.quantity} on this invoice</div></td>
                  <td className="px-3 py-2 text-right">{formatMoney(l.poUnitPrice, cur)}</td><td className="px-3 py-2 text-right">{formatMoney(l.unitPrice, cur)}</td>
                  <td className={`px-3 py-2 ${l.problems.length ? "text-danger" : "text-ok"}`}>{l.problems.length ? l.problems.join("; ") : "OK"}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="border-t-2 border-line font-semibold"><td className="px-3 py-2" colSpan={5}>Invoice total</td><td className="px-3 py-2 text-right">{formatMoney(match.total, cur)}</td>
                <td className="px-3 py-2 text-sm font-normal">{match.difference ? <span className="text-danger">{formatMoney(match.difference, cur)} more than the PO price</span> : "Same as the PO price"}</td></tr>
                {deducted > 0 && <>
                  <tr><td className="px-3 py-1" colSpan={5}>Less delay penalty</td><td className="px-3 py-1 text-right text-danger">−{formatMoney(deducted, cur)}</td><td /></tr>
                  <tr className="font-semibold"><td className="px-3 py-2" colSpan={5}>Amount payable</td><td className="px-3 py-2 text-right">{formatMoney(Math.max(0, match.total - deducted), cur)}</td><td /></tr>
                </>}</tfoot>
            </table></div>
          </Panel>
          {(deducted > 0 || (penalty && penalty.amount > 0)) && (
            <Panel title="Delay penalty">
              {i.delayPenaltyNote ? <pre className="whitespace-pre-wrap font-sans text-sm">{i.delayPenaltyNote}</pre>
                : penalty && penalty.amount > 0 ? <p className="text-sm">{po.number} was delivered late: the penalty is {formatMoney(penalty.amount, cur)}{penalty.provisional ? " so far (units still outstanding)" : ""}{penalty.deducted > 0 ? `, of which ${formatMoney(penalty.deducted, cur)} is deducted on other invoices` : ""}. <Link href={`/procurement/purchase-orders/${po.id}`} className="text-primary hover:underline">See the calculation</Link></p> : null}
              {mayDeduct && (
                <ActionForm action={setInvoicePenaltyAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <input type="hidden" name="invoiceId" value={id} />
                  <Field label={`Deduct (${cur})`} hint={`Left to deduct on this order: ${formatMoney(left, cur)}. 0 removes the deduction.`}>
                    <Input type="number" min={0} step="0.01" name="delayPenalty" defaultValue={deducted > 0 ? deducted : Math.min(left, match.total)} className="w-40" />
                  </Field>
                  <Button variant="secondary">{deducted > 0 ? "Update delay penalty" : "Deduct delay penalty"}</Button>
                </ActionForm>
              )}
            </Panel>
          )}
          <DocumentsPanel entityType="po" entityId={po.id} returnPath={`/procurement/invoices/${id}`} title="Invoice scans (kept with the PO)" />
        </div>
        <aside className="space-y-6">
          <Panel title="Invoice">
            <Details items={[
              { label: "Invoice date", value: formatDate(i.invoiceDate) }, { label: "Due", value: formatDate(i.dueDate) },
              { label: "Recorded by", value: i.createdByName }, { label: "Decision", value: i.approvedByName ? `${i.status === "REJECTED" ? "Rejected" : "Approved"} by ${i.approvedByName}, ${formatDateTime(i.approvedAt)}` : null },
              { label: "Reason", value: i.decisionNote },
              { label: "Delay penalty", value: deducted > 0 ? `${formatMoney(deducted, cur)} deducted` : null }, { label: "Paid", value: i.paidAt ? `${formatDate(i.paidAt)}${i.paymentReference ? ` · ${i.paymentReference}` : ""}` : null },
            ]} />
            {i.notes && <p className="mt-3 whitespace-pre-line text-sm">{i.notes}</p>}
          </Panel>
          {canDecide && waiting && decideBlock && <Panel title="Decide"><p className="text-sm text-muted">{decideBlock}</p></Panel>}
          {canDecide && waiting && !decideBlock && (
            <Panel title="Decide">
              <ActionForm action={decideInvoiceAction} className="space-y-3">
                <input type="hidden" name="invoiceId" value={id} />
                <Field label={match.ok ? "Note (optional)" : "Reason (needed to approve with differences, or to reject)"}><Textarea name="note" rows={2} /></Field>
                <div className="flex gap-2"><Button name="decision" value="approve">{match.ok ? "Approve for payment" : "Approve anyway"}</Button><Button variant="secondary" name="decision" value="reject">Reject</Button></div>
              </ActionForm>
            </Panel>
          )}
          {canDecide && i.status === "APPROVED" && payBlock && <Panel title="Record payment"><p className="text-sm text-muted">{payBlock}</p></Panel>}
          {canDecide && i.status === "APPROVED" && !payBlock && (
            <Panel title="Record payment">
              <ActionForm action={markPaidAction} className="space-y-3">
                <input type="hidden" name="invoiceId" value={id} />
                <Field label="Paid on"><Input type="date" name="paidAt" defaultValue={todayISO()} required /></Field>
                <Field label="Payment reference"><Input name="paymentReference" maxLength={120} /></Field>
                <Button>Mark paid</Button>
              </ActionForm>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

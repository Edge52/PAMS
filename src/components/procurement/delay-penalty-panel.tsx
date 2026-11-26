/**
 * Late-delivery penalty on a purchase order's page (wave 37; Law 182/2018 art. 48 rules in wave 39). Server component,
 * shown only to people who may see prices: the calculation from the expected date and the goods receipts, what
 * invoices have deducted so far, the order's contract type, basis, own rate and cap, and a waiver with its reason.
 */
import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, purchaseOrders } from "@/db/schema";
import { Badge, Field, FormGrid, Input, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { CONTRACT_TYPE_LABELS, CONTRACT_TYPES, penaltyLeft, termsText } from "@/lib/procurement/delay-penalty";
import { poDelayPenalty } from "@/lib/procurement/penalty-server";
import { setDelayPenaltyTermsAction, waiveDelayPenaltyAction } from "@/app/procurement/purchase-orders/actions";

export async function DelayPenaltyPanel({ po, me }: { po: typeof purchaseOrders.$inferSelect; me: CurrentUser }) {
  const p = await poDelayPenalty(po.id);
  if (!p) return null;
  const cur = po.currency;
  const deductedOn = await db.select({ id: invoices.id, number: invoices.number, amount: invoices.delayPenalty }).from(invoices)
    .where(sql`${invoices.poId} = ${po.id} and ${invoices.delayPenalty} is not null and ${invoices.status} <> 'REJECTED'`).orderBy(asc(invoices.id));
  const left = penaltyLeft(p.amount, p.deducted);
  const mayEdit = can(me.role, "po.create") && po.status !== "CANCELLED";
  const mayWaive = can(me.role, "invoices.approve");
  const works = p.terms.contractType === "WORKS";
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">Late delivery penalty {p.waived && p.grossAmount > 0 ? <Badge tone="info">Waived</Badge> : p.amount > 0 ? <Badge tone={p.provisional ? "warn" : "danger"}>{formatMoney(p.amount, cur)}{p.provisional ? " so far" : ""}</Badge> : <Badge tone="ok">None</Badge>}</span>}>
      <p className="text-sm text-muted">
        {termsText(p.terms)}{p.ownTerms ? " This order has its own rate or cap." : ""}{p.typeSet ? "" : " Contract type not set: read as supply."}
        {" "}{p.due ? <>Expected delivery {formatDate(p.due)}{p.terms.periodDays ? `, a delivery period of ${formatNumber(p.terms.periodDays)} days from the order` : ""}.</> : "Set the expected delivery date to work it out."}
      </p>
      {p.parts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {p.parts.map((x, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 border-t border-line pt-1.5">
              <span>{formatNumber(x.units)} × {x.description}
                <span className="block text-xs text-muted">{x.deliveredOn ? `Delivered ${formatDate(x.deliveredOn)}` : `Not delivered yet (to ${formatDate(p.asOf)})`}: {x.daysLate} day{x.daysLate === 1 ? "" : "s"} late{x.sharePct != null ? ` (${x.sharePct} % of the period)` : ""}{works ? ` = ${x.weeks} week${x.weeks === 1 ? "" : "s"}` : ""} → {x.pct} %{x.capped ? ` (cap ${x.capPct} %)` : ""} of {formatMoney(x.value, cur)}</span></span>
              <span className="font-semibold tabular-nums">{formatMoney(x.amount, cur)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.provisional && !p.waived && <p className="mt-2 text-xs text-warn">Units are still outstanding, so the penalty grows until they arrive or the cap is reached.</p>}
      {p.waived && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-info-soft px-3 py-2 text-sm">Waived{p.grossAmount > 0 ? ` (${formatMoney(p.grossAmount, cur)})` : ""}{p.waivedByName ? ` by ${p.waivedByName}` : ""}{p.waivedAt ? ` on ${formatDateTime(p.waivedAt)}` : ""}: <span className="whitespace-pre-line">{p.waived}</span></p>
      )}
      {(p.amount > 0 || deductedOn.length > 0) && (
        <p className="mt-3 border-t border-line pt-2 text-sm">Deducted on invoices: {deductedOn.length ? deductedOn.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`/procurement/invoices/${d.id}`} className="text-primary hover:underline">{d.number}</Link> {formatMoney(d.amount, cur)}</span>) : "none yet"}. Left to deduct: <b>{formatMoney(left, cur)}</b>.</p>
      )}
      {mayEdit && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Change this order&apos;s penalty terms</summary>
          <ActionForm action={setDelayPenaltyTermsAction} className="mt-2 space-y-3">
            <input type="hidden" name="poId" value={po.id} />
            <FormGrid cols={3}>
              <Field label="Contract type" hint="Supply and services: steps by the delay's share of the delivery period. Works: a rate a week.">
                <Select name="contractType" defaultValue={p.terms.contractType} options={CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_LABELS[t] }))} />
              </Field>
              <Field label="Rate a week, works only (%)" hint="Blank = hospital rule"><Input type="number" min={0} max={100} step="0.1" name="delayPenaltyRatePct" defaultValue={po.delayPenaltyRatePct ?? ""} /></Field>
              <Field label="At most (%)" hint="Blank = hospital rule"><Input type="number" min={0} max={100} step="0.1" name="delayPenaltyCapPct" defaultValue={po.delayPenaltyCapPct ?? ""} /></Field>
            </FormGrid>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="blocksUse" defaultChecked={p.terms.blocksUse} className="mt-1" />
              <span>The late part prevents use of what was delivered<span className="block text-xs text-muted">The penalty is then on the whole order&apos;s value, not only the late items.</span></span></label>
            <SubmitButton variant="secondary">Save penalty terms</SubmitButton>
          </ActionForm>
        </details>
      )}
      {mayWaive && (p.grossAmount > 0 || p.waived) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">{p.waived ? "Take the waiver back" : "Waive the penalty"}</summary>
          <ActionForm action={waiveDelayPenaltyAction} className="mt-2 space-y-3">
            <input type="hidden" name="poId" value={po.id} />
            {p.waived ? <input type="hidden" name="undo" value="1" /> : (
              <Field label="Reason" hint="For example the competent authority's decision, and why the delay was not the supplier's fault.">
                <Textarea name="reason" rows={3} maxLength={2000} required />
              </Field>
            )}
            <SubmitButton variant="secondary">{p.waived ? "Take the waiver back" : "Waive the penalty"}</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

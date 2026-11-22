/**
 * Late-delivery penalty on a purchase order's page (wave 37; Law 182/2018 delay fines). Server component, shown only
 * to people who may see prices: the calculation from the expected date and the goods receipts, what invoices have
 * deducted so far, and the order's own rate and cap.
 */
import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, purchaseOrders } from "@/db/schema";
import { Badge, Field, FormGrid, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/procurement/action-form";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { penaltyLeft } from "@/lib/procurement/delay-penalty";
import { poDelayPenalty } from "@/lib/procurement/penalty-server";
import { setDelayPenaltyTermsAction } from "@/app/procurement/purchase-orders/actions";

export async function DelayPenaltyPanel({ po, me }: { po: typeof purchaseOrders.$inferSelect; me: CurrentUser }) {
  const p = await poDelayPenalty(po.id);
  if (!p) return null;
  const cur = po.currency;
  const deductedOn = await db.select({ id: invoices.id, number: invoices.number, amount: invoices.delayPenalty }).from(invoices)
    .where(sql`${invoices.poId} = ${po.id} and ${invoices.delayPenalty} is not null and ${invoices.status} <> 'REJECTED'`).orderBy(asc(invoices.id));
  const left = penaltyLeft(p.amount, p.deducted);
  const mayEdit = can(me.role, "po.create") && po.status !== "CANCELLED";
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">Late delivery penalty {p.amount > 0 ? <Badge tone={p.provisional ? "warn" : "danger"}>{formatMoney(p.amount, cur)}{p.provisional ? " so far" : ""}</Badge> : <Badge tone="ok">None</Badge>}</span>}>
      <p className="text-sm text-muted">
        {p.terms.ratePctPerWeek} % of the late items&apos; value for each week of delay or part of a week, at most {p.terms.capPct} %{p.ownTerms ? " (this order's terms)" : " (hospital default)"}.
        {" "}{p.due ? <>Expected delivery {formatDate(p.due)}.</> : "Set the expected delivery date to work it out."}
      </p>
      {p.parts.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {p.parts.map((x, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 border-t border-line pt-1.5">
              <span>{formatNumber(x.units)} × {x.description}
                <span className="block text-xs text-muted">{x.deliveredOn ? `Delivered ${formatDate(x.deliveredOn)}` : `Not delivered yet (to ${formatDate(p.asOf)})`}: {x.daysLate} day{x.daysLate === 1 ? "" : "s"} late = {x.weeks} week{x.weeks === 1 ? "" : "s"} → {x.pct} %{x.capped ? " (cap)" : ""} of {formatMoney(x.value, cur)}</span></span>
              <span className="font-semibold tabular-nums">{formatMoney(x.amount, cur)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.provisional && <p className="mt-2 text-xs text-warn">Units are still outstanding, so the penalty grows each week until they arrive or the cap is reached.</p>}
      {(p.amount > 0 || deductedOn.length > 0) && (
        <p className="mt-3 border-t border-line pt-2 text-sm">Deducted on invoices: {deductedOn.length ? deductedOn.map((d, i) => <span key={d.id}>{i ? ", " : ""}<Link href={`/procurement/invoices/${d.id}`} className="text-primary hover:underline">{d.number}</Link> {formatMoney(d.amount, cur)}</span>) : "none yet"}. Left to deduct: <b>{formatMoney(left, cur)}</b>.</p>
      )}
      {mayEdit && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Change this order&apos;s penalty terms</summary>
          <ActionForm action={setDelayPenaltyTermsAction} className="mt-2 space-y-3">
            <input type="hidden" name="poId" value={po.id} />
            <FormGrid cols={2}>
              <Field label="Rate a week (%)" hint="Blank = hospital default"><Input type="number" min={0} max={100} step="0.1" name="delayPenaltyRatePct" defaultValue={po.delayPenaltyRatePct ?? ""} /></Field>
              <Field label="At most (%)" hint="Blank = hospital default"><Input type="number" min={0} max={100} step="0.1" name="delayPenaltyCapPct" defaultValue={po.delayPenaltyCapPct ?? ""} /></Field>
            </FormGrid>
            <SubmitButton variant="secondary">Save penalty terms</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

/**
 * Tender tab (wave 10): envelopes (one or two, Law 182 art. 23), bonds (bid bond art. 16, performance bond art. 40),
 * printable minutes and the technical evaluation sheet, and validity extension letters.
 */
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bonds, offers, projects, purchaseOrders, suppliers } from "@/db/schema";
import { Badge, Button, Field, Input, Panel, StatusBadge } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { CURRENCIES, formatDate, formatDateTime, formatMoney, todayISO } from "@/lib/format";
import { EXCLUDED_OFFER_STATUSES } from "@/lib/procurement/labels";
import { BOND_RATE, requiredBond } from "@/lib/procurement/money";
import { poValues } from "@/lib/procurement/money-server";
import { offerTotals } from "@/lib/procurement/server";
import { addBondAction, openEnvelopesAction, setBondStatusAction, setEnvelopesAction } from "../../tender-actions";

type Project = typeof projects.$inferSelect;

export async function TenderTab({ project: p, me }: { project: Project; me: CurrentUser }) {
  const canEdit = can(me.role, "procurement.edit");
  const [offs, pos, bs] = await Promise.all([
    db.select({ id: offers.id, ref: offers.reference, status: offers.status, currency: offers.currency, ts: offers.technicalScore, validUntil: offers.validUntil, supplier: suppliers.name, supplierId: offers.supplierId })
      .from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId)).where(eq(offers.projectId, p.id)).orderBy(asc(offers.id)),
    db.select({ id: purchaseOrders.id, number: purchaseOrders.number, currency: purchaseOrders.currency, status: purchaseOrders.status, supplier: suppliers.name })
      .from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId)).where(eq(purchaseOrders.projectId, p.id)),
    db.select({ b: bonds, supplier: suppliers.name }).from(bonds).innerJoin(suppliers, eq(suppliers.id, bonds.supplierId)).where(eq(bonds.projectId, p.id)).orderBy(desc(bonds.id)),
  ]);
  const [ot, pv] = await Promise.all([offerTotals(offs.map((o) => o.id)), poValues(pos.map((x) => x.id))]);
  const live = offs.filter((o) => !EXCLUDED_OFFER_STATUSES.includes(o.status));
  const evaluated = live.filter((o) => o.ts != null).length;
  const sealed = p.twoEnvelope && !p.financialOpenedAt;
  const today = todayISO();
  const soon = (d: string | null) => d != null && d >= today && Date.parse(d) - Date.parse(today) <= 30 * 864e5;
  const held = (offerId: number | null, poId: number | null, kind: string) => bs.filter((x) => x.b.status === "HELD" && x.b.kind === kind && (offerId ? x.b.offerId === offerId : x.b.poId === poId));
  const m = (href: string, label: string) => <Link href={href} target="_blank" className="text-primary hover:underline">{label}</Link>;

  return (
    <div className="space-y-5">
      <Panel title="Envelopes" actions={<Badge tone={p.twoEnvelope ? "info" : "neutral"}>{p.twoEnvelope ? "Two envelopes" : "Single envelope"}</Badge>}>
        <ol className="space-y-3 text-sm">
          <li><b>1. Technical envelopes</b> — {p.technicalOpenedAt ? `opened ${formatDateTime(p.technicalOpenedAt)}. ` : "not opened yet. "}
            {m(`/procurement/${p.id}/minutes?kind=opening`, "Opening minutes")}</li>
          <li><b>2. Technical evaluation</b> — {evaluated} of {live.length} offer{live.length === 1 ? "" : "s"} evaluated. {m(`/procurement/${p.id}/evaluation-sheet`, "Technical evaluation sheet")} · {m(`/procurement/${p.id}/minutes?kind=technical`, "Technical minutes")}</li>
          {p.twoEnvelope && <li><b>3. Financial envelopes</b> — {p.financialOpenedAt ? `opened ${formatDateTime(p.financialOpenedAt)}. ` : "sealed: prices are hidden from the comparison and the offers. "}{p.financialOpenedAt && m(`/procurement/${p.id}/minutes?kind=financial`, "Financial minutes")}</li>}
          <li><b>{p.twoEnvelope ? 4 : 3}. Award</b> — {m(`/procurement/${p.id}/minutes?kind=award`, "Award minutes and recommendation")}</li>
        </ol>
        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            {!p.technicalOpenedAt && (
              <ActionForm action={setEnvelopesAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="two" value={p.twoEnvelope ? "0" : "1"} />
                <Button variant="secondary">{p.twoEnvelope ? "Make it a single-envelope tender" : "Make it a two-envelope tender"}</Button></ActionForm>
            )}
            {!p.technicalOpenedAt && <ActionForm action={openEnvelopesAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="which" value="technical" /><Button>Record technical envelopes opened</Button></ActionForm>}
            {p.twoEnvelope && p.technicalOpenedAt && sealed && (
              <ActionForm action={openEnvelopesAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="which" value="financial" /><Button disabled={evaluated < live.length}>Open financial envelopes</Button>
                {evaluated < live.length && <p className="mt-1 text-xs text-muted">Possible once every offer is evaluated or rejected.</p>}</ActionForm>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Bonds and guarantees" padded={false}>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-sunken text-left text-muted"><tr><th className="px-3 py-2">For</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2 text-right">Required</th><th className="px-3 py-2">Held</th><th className="px-3 py-2">Expires</th></tr></thead>
          <tbody>
            {live.map((o) => {
              const req = sealed ? null : requiredBond("BID", ot.get(o.id) ?? 0); const h = held(o.id, null, "BID");
              const sum = h.reduce((s, x) => s + Number(x.b.amount), 0);
              return (
                <tr key={`o${o.id}`} className="border-t border-line">
                  <td className="px-3 py-2">{o.supplier}<div className="text-xs text-muted">offer {o.ref}{o.validUntil ? ` · valid to ${formatDate(o.validUntil)} · ` : " · "}<Link href={`/procurement/offers/${o.id}/extension-letter`} target="_blank" className="text-primary hover:underline">validity extension letter</Link></div></td>
                  <td className="px-3 py-2">Bid bond ({BOND_RATE.BID * 100} %)</td>
                  <td className="px-3 py-2 text-right">{req != null ? formatMoney(req, o.currency) : <span className="text-muted">sealed</span>}</td>
                  <td className="px-3 py-2">{h.length ? <>{formatMoney(sum, h[0].b.currency)} {req != null && sum + 0.005 < req && <Badge tone="danger">short</Badge>}</> : <Badge tone="warn">none</Badge>}</td>
                  <td className="px-3 py-2">{h.map((x) => <span key={x.b.id} className={soon(x.b.expiryDate) || (x.b.expiryDate && x.b.expiryDate < today) ? "text-danger" : ""}>{formatDate(x.b.expiryDate)} </span>)}</td>
                </tr>
              );
            })}
            {pos.filter((x) => x.status !== "CANCELLED").map((x) => {
              const req = requiredBond("PERFORMANCE", pv.get(x.id) ?? 0); const h = held(null, x.id, "PERFORMANCE"); const sum = h.reduce((s, y) => s + Number(y.b.amount), 0);
              return (
                <tr key={`p${x.id}`} className="border-t border-line">
                  <td className="px-3 py-2">{x.supplier}<div className="text-xs text-muted">{x.number}</div></td><td className="px-3 py-2">Performance bond ({BOND_RATE.PERFORMANCE * 100} %)</td>
                  <td className="px-3 py-2 text-right">{formatMoney(req, x.currency)}</td>
                  <td className="px-3 py-2">{h.length ? <>{formatMoney(sum, h[0].b.currency)} {sum + 0.005 < req && <Badge tone="danger">short</Badge>}</> : <Badge tone="warn">none</Badge>}</td>
                  <td className="px-3 py-2">{h.map((y) => <span key={y.b.id} className={soon(y.b.expiryDate) || (y.b.expiryDate && y.b.expiryDate < today) ? "text-danger" : ""}>{formatDate(y.b.expiryDate)} </span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {bs.length > 0 && (
          <ul className="divide-y divide-line border-t border-line text-sm">{bs.map((x) => (
            <li key={x.b.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>{x.supplier}: {x.b.kind.toLowerCase().replace("_", " ")} bond {formatMoney(x.b.amount, x.b.currency)}{x.b.bank ? ` · ${x.b.bank}` : ""}{x.b.reference ? ` · ${x.b.reference}` : ""}{x.b.expiryDate ? ` · expires ${formatDate(x.b.expiryDate)}` : ""}</span>
              <span className="flex items-center gap-2"><StatusBadge value={x.b.status} />
                {canEdit && x.b.status === "HELD" && (["RELEASED", "CALLED"] as const).map((s) => (
                  <ActionForm key={s} action={setBondStatusAction}><input type="hidden" name="projectId" value={p.id} /><input type="hidden" name="bondId" value={x.b.id} /><input type="hidden" name="status" value={s} />
                    <button className="text-xs text-primary hover:underline">{s === "RELEASED" ? "Release" : "Call"}</button></ActionForm>
                ))}</span>
            </li>
          ))}</ul>
        )}
        {canEdit && (
          <ActionForm action={addBondAction} className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="projectId" value={p.id} />
            <Field label="Kind"><NativeSelect name="kind" value="BID" options={[{ value: "BID", label: "Bid bond" }, { value: "PERFORMANCE", label: "Performance bond" }, { value: "ADVANCE_PAYMENT", label: "Advance payment guarantee" }]} /></Field>
            <Field label="Offer (bid bond)"><NativeSelect name="offerId" placeholder="—" options={live.map((o) => ({ value: o.id, label: `${o.supplier} · ${o.ref}` }))} /></Field>
            <Field label="Purchase order (other bonds)"><NativeSelect name="poId" placeholder="—" options={pos.map((x) => ({ value: x.id, label: `${x.number} · ${x.supplier}` }))} /></Field>
            <Field label="Bank"><Input name="bank" maxLength={200} /></Field>
            <Field label="Amount"><Input name="amount" required inputMode="decimal" /></Field>
            <Field label="Currency"><NativeSelect name="currency" value={p.currency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
            <Field label="Bank reference"><Input name="reference" maxLength={120} /></Field>
            <Field label="Expires"><Input type="date" name="expiryDate" /></Field>
            <div><Button variant="secondary">Record bond</Button></div>
          </ActionForm>
        )}
        <p className="px-4 pb-3 text-xs text-muted">Required amounts use {BOND_RATE.BID * 100} % of the offer total for a bid bond and {BOND_RATE.PERFORMANCE * 100} % of the order value for a performance bond (Law 182/2018 art. 16 and 40).</p>
      </Panel>
    </div>
  );
}

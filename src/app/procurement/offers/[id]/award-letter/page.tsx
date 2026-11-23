import Link from "next/link";
import { notFound } from "next/navigation";
import { contactFor } from "@/components/procurement/supplier-contacts";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatMoney, formatNumber, lineTotal, round2, todayISO } from "@/lib/format";
import { INCOTERM_LABELS, type Incoterm } from "@/lib/procurement/labels";
import { BOND_RATE, requiredBond } from "@/lib/procurement/money";
import { pricesSealed } from "@/lib/procurement/sealed";
import { LegalNameAr } from "@/components/procurement/legal-name";
import { letterContext } from "@/lib/procurement/letters-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Award letter" };

/**
 * Award letter to the winning bidder (wave 37; Law 182/2018 art. 39): items, quantities and the awarded value, the
 * committee's recommendation and the authority's approval, and the complaint period. A draft to print on the
 * hospital's letterhead and sign. Shows prices, so only for people who may see them (audit R9).
 */
export default async function AwardLetter({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("prices.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const c = await letterContext(id);
  if (!c) notFound();
  await requireFacilityAccess(c.project.facilityId, me);
  const back = <Link href={`/procurement/${c.project.id}?tab=committees`} className="text-primary hover:underline">← Back to the tender</Link>;
  if (c.kind !== "award") {
    return <div className="mx-auto max-w-2xl space-y-3 text-sm"><p>{back}</p><p className="rounded border border-line bg-surface p-4">An award letter is for an offer whose award the competent authority has approved. {c.kind === "regret" ? <Link href={`/procurement/offers/${id}/regret-letter`} className="font-semibold text-primary hover:underline">Open the regret letter for this offer</Link> : "This offer has no letter."}</p></div>;
  }
  const { offer: o, supplier: s, project: p } = c;
  const sealed = pricesSealed(p);
  const cur = o.currency;
  const rows = c.lines.map((l) => ({ l, net: l.quantity ? lineTotal(l.quantity, l.unitPrice, l.discountPct) / l.quantity : 0, total: lineTotal(l.quantity, l.unitPrice, l.discountPct) }));
  const total = round2(rows.reduce((t, r) => t + r.total, 0));
  const sales = await contactFor(s.id, "SALES");
  const money = (n: number) => (sealed ? "Sealed" : formatMoney(n, cur));
  return (
    <>
      <ReportPrintStyles />
      <div className="no-print mb-4 flex flex-wrap items-center gap-3 text-sm">{back}<PrintButton /></div>
      <article className="mx-auto max-w-2xl rounded border border-line bg-surface p-8 text-[15px] leading-relaxed print:border-0 print:p-0">
        <p className="text-right">{formatDate(todayISO())}</p>
        <p className="mt-6">To: <b>{s.name}</b><LegalNameAr name={c.supplierAr} />{sales || s.contactName ? <><br />Attn: {sales?.name ?? s.contactName}{sales?.email ? ` (${sales.email})` : ""}</> : null}{s.address ? <><br />{s.address}</> : null}</p>
        <p className="mt-6 font-semibold">Subject: Notice of award — tender {p.code}, {p.title}</p>
        <p className="mt-4">Dear Sirs,</p>
        <p className="mt-3">With reference to your offer no. {o.reference} dated {formatDate(o.offerDate)} submitted for the above tender{c.facility ? ` of ${c.facility}` : ""}, we are pleased to inform you that, on the recommendation of the adjudication committee{c.committeeDate ? ` dated ${formatDate(c.committeeDate)}` : ""}, approved by the competent authority on <b>{formatDate(c.approvedOn)}</b>, the tender has been awarded to your company for the following items:</p>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead><tr className="border-b border-ink text-left"><th className="py-1 pr-2">#</th><th className="py-1 pr-2">Item</th><th className="py-1 pr-2 text-right">Qty</th><th className="py-1 pr-2 text-right">Unit price</th><th className="py-1 text-right">Total</th></tr></thead>
          <tbody>{rows.map(({ l, net, total: t }, i) => (
            <tr key={l.id} className="border-b border-line align-top">
              <td className="py-1 pr-2">{i + 1}</td>
              <td className="py-1 pr-2">{l.description}<LegalNameAr name={c.typesAr.get(l.deviceTypeId)} className="text-xs" />{l.manufacturer || l.model ? <span className="block text-xs">{[l.manufacturer, l.model].filter(Boolean).join(" ")}{l.countryOfOrigin ? `, ${l.countryOfOrigin}` : ""}</span> : null}</td>
              <td className="py-1 pr-2 text-right">{formatNumber(l.quantity)}</td>
              <td className="py-1 pr-2 text-right whitespace-nowrap">{money(net)}</td>
              <td className="py-1 text-right whitespace-nowrap">{money(t)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={4} className="py-1 pr-2 text-right font-semibold">Total awarded value</td><td className="py-1 text-right font-bold whitespace-nowrap">{money(total)}</td></tr></tfoot>
        </table>
        <p className="mt-3 text-sm">Prices after discounts, in {cur}{o.incoterm ? `, ${INCOTERM_LABELS[o.incoterm as Incoterm]}` : ""}{o.deliveryWeeks != null ? `; delivery within ${o.deliveryWeeks} weeks` : ""}{o.warrantyMonths != null ? `; warranty ${o.warrantyMonths} months` : ""}{o.paymentTerms ? `; payment: ${o.paymentTerms}` : ""}.</p>
        <p className="mt-3">All bidders are being notified of this result. Under Law 182/2018 (art. 39) complaints may be made until <b>{formatDate(c.complaintUntil)}</b>. The formal notice of acceptance will follow after that period, by {formatDate(c.acceptanceDue)}, and the purchase order will then be issued.</p>
        <p className="mt-3">Please be ready to provide a performance bond of {BOND_RATE.PERFORMANCE * 100} % of the contract value{sealed ? "" : ` (${formatMoney(requiredBond("PERFORMANCE", total), cur)})`}, as the tender conditions require.</p>
        <p className="mt-6">Yours faithfully,</p>
        <div className="mt-14 w-64 border-t border-ink pt-1 text-sm">Procurement department<br />{c.facility ?? ""}<LegalNameAr name={c.facilityAr} /></div>
        <p className="no-print mt-8 text-xs text-muted">Draft prepared by {me.name}. Check the items, the value and the dates before sending.</p>
      </article>
    </>
  );
}

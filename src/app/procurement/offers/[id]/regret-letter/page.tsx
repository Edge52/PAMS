import Link from "next/link";
import { notFound } from "next/navigation";
import { contactFor } from "@/components/procurement/supplier-contacts";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { LegalNameAr } from "@/components/procurement/legal-name";
import { letterContext, regretReasonFor } from "@/lib/procurement/letters-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Regret letter" };

/**
 * Regret letter to a bidder that was not awarded (wave 37; Law 182/2018 art. 39): the items it quoted, why it was
 * not selected (from the evaluation: non-compliance, partial bid or ranking; editable), the award decision dates and
 * the complaint period. No prices. A draft to print on the hospital's letterhead and sign.
 */
export default async function RegretLetter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reason?: string }> }) {
  const me = await requirePermission("prices.view"); // evaluation results stay with those who see the offers (R9)
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const c = await letterContext(id);
  if (!c) notFound();
  await requireFacilityAccess(c.project.facilityId, me);
  const back = <Link href={`/procurement/${c.project.id}?tab=committees`} className="text-primary hover:underline">← Back to the tender</Link>;
  if (c.kind !== "regret" || !c.awarded) {
    return <div className="mx-auto max-w-2xl space-y-3 text-sm"><p>{back}</p><p className="rounded border border-line bg-surface p-4">{c.kind === "award"
      ? <>This offer won the award. <Link href={`/procurement/offers/${id}/award-letter`} className="font-semibold text-primary hover:underline">Open the award letter</Link></>
      : !c.awarded ? "Regret letters can be prepared once the competent authority has approved the award of this tender." : "Withdrawn offers get no letter."}</p></div>;
  }
  const { offer: o, supplier: s, project: p } = c;
  const typed = (await searchParams).reason?.trim().slice(0, 1500);
  const reason = typed || await regretReasonFor(o.id, p.id, o.status, c.awarded.supplier);
  const sales = await contactFor(s.id, "SALES");
  return (
    <>
      <ReportPrintStyles />
      <form className="no-print mb-4 flex flex-wrap items-end gap-3 text-sm">
        {back}
        <label className="flex min-w-72 flex-1 flex-col">Reason given<textarea name="reason" rows={2} defaultValue={reason} className="rounded border border-line px-2 py-1" /></label>
        <button className="rounded border border-line px-3 py-1">Update</button>
        <PrintButton />
      </form>
      <article className="mx-auto max-w-2xl rounded border border-line bg-surface p-8 text-[15px] leading-relaxed print:border-0 print:p-0">
        <p className="text-right">{formatDate(todayISO())}</p>
        <p className="mt-6">To: <b>{s.name}</b><LegalNameAr name={c.supplierAr} />{sales || s.contactName ? <><br />Attn: {sales?.name ?? s.contactName}{sales?.email ? ` (${sales.email})` : ""}</> : null}{s.address ? <><br />{s.address}</> : null}</p>
        <p className="mt-6 font-semibold">Subject: Result of tender {p.code}, {p.title}</p>
        <p className="mt-4">Dear Sirs,</p>
        <p className="mt-3">Thank you for your offer no. {o.reference} dated {formatDate(o.offerDate)} for the above tender{c.facility ? ` of ${c.facility}` : ""}, covering:</p>
        <ul className="mt-2 list-disc pl-6 text-sm">{c.lines.map((l) => <li key={l.id}>{formatNumber(l.quantity)} × {l.description}{l.manufacturer || l.model ? ` (${[l.manufacturer, l.model].filter(Boolean).join(" ")})` : ""}</li>)}</ul>
        <p className="mt-3">We regret to inform you that your offer was not selected. On the recommendation of the adjudication committee{c.committeeDate ? ` dated ${formatDate(c.committeeDate)}` : ""}, approved by the competent authority on {formatDate(c.approvedOn)}, the tender was awarded to <b>{c.awarded.supplier}</b>{c.awardedAr ? <> (<LegalNameAr name={c.awardedAr} block={false} />)</> : null}.</p>
        <p className="mt-3"><b>Reason:</b> {reason}</p>
        <p className="mt-3">Under Law 182/2018 (art. 39) you may send a written complaint about this decision until <b>{formatDate(c.complaintUntil)}</b>.{c.bidBond ? <> After that period your bid bond no. {c.bidBond.reference ?? "……"}{c.bidBond.bank ? ` issued by ${c.bidBond.bank}` : ""} will be returned to you.</> : " After that period any bid bond you provided will be returned to you."}</p>
        <p className="mt-3">We thank you for your interest and hope to receive your offers in future tenders.</p>
        <p className="mt-6">Yours faithfully,</p>
        <div className="mt-14 w-64 border-t border-ink pt-1 text-sm">Procurement department<br />{c.facility ?? ""}<LegalNameAr name={c.facilityAr} /></div>
        <p className="no-print mt-8 text-xs text-muted">Draft prepared by {me.name}. Check the reason and the dates before sending.</p>
      </article>
    </>
  );
}

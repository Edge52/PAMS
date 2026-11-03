import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bonds, facilities, offers, projects, suppliers } from "@/db/schema";
import { PrintButton } from "@/components/reports/print";
import { ReportPrintStyles } from "@/components/reports/print-styles";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { addDaysISO, formatDate, formatMoney, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Validity extension letter" };

/**
 * Letter asking a bidder to extend its offer's validity and its bid bond (wave 10; Law 182/2018 art. 27). A draft to
 * print on the hospital's letterhead and sign.
 */
export default async function ExtensionLetter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ until?: string; reply?: string }> }) {
  const me = await requirePermission("procurement.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [r] = await db.select({ o: offers, s: suppliers, p: projects, facility: facilities.name }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .innerJoin(projects, eq(projects.id, offers.projectId)).leftJoin(facilities, eq(facilities.id, projects.facilityId)).where(eq(offers.id, id));
  if (!r) notFound();
  await requireFacilityAccess(r.p.facilityId, me);
  const sp = await searchParams;
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const until = ok(sp.until) ?? addDaysISO(r.o.validUntil ?? todayISO(), 30);
  const reply = ok(sp.reply) ?? addDaysISO(todayISO(), 7);
  const [bond] = await db.select().from(bonds).where(and(eq(bonds.offerId, id), eq(bonds.kind, "BID"), eq(bonds.status, "HELD")));
  return (
    <>
      <ReportPrintStyles />
      <form className="no-print mb-4 flex flex-wrap items-end gap-3 text-sm">
        <Link href={`/procurement/${r.p.id}?tab=tender`} className="text-primary hover:underline">← Back to the tender</Link>
        <label className="flex flex-col">Extend validity to<input type="date" name="until" defaultValue={until} className="rounded border border-line px-2 py-1" /></label>
        <label className="flex flex-col">Reply by<input type="date" name="reply" defaultValue={reply} className="rounded border border-line px-2 py-1" /></label>
        <button className="rounded border border-line px-3 py-1">Update</button>
        <PrintButton />
      </form>
      <article className="mx-auto max-w-2xl rounded border border-line bg-surface p-8 text-[15px] leading-relaxed print:border-0 print:p-0">
        <p className="text-right">{formatDate(todayISO())}</p>
        <p className="mt-6">To: <b>{r.s.name}</b>{r.s.contactName ? <><br />Attn: {r.s.contactName}</> : null}{r.s.address ? <><br />{r.s.address}</> : null}</p>
        <p className="mt-6 font-semibold">Subject: Extension of offer validity — {r.p.code}, {r.p.title}</p>
        <p className="mt-4">Dear Sirs,</p>
        <p className="mt-3">With reference to your offer no. {r.o.reference} dated {formatDate(r.o.offerDate)} submitted for the above tender{r.facility ? ` of ${r.facility}` : ""}, valid until {formatDate(r.o.validUntil)}, and as the evaluation is still in progress, we kindly ask you to extend the validity of your offer, on the same prices and conditions, until <b>{formatDate(until)}</b>.</p>
        <p className="mt-3">{bond ? <>Please also extend your bid bond no. {bond.reference ?? "……"} issued by {bond.bank ?? "……"} for {formatMoney(bond.amount, bond.currency)}, currently valid until {formatDate(bond.expiryDate)}, to at least the same date.</> : <>Please also extend your bid bond to at least the same date.</>}</p>
        <p className="mt-3">We would be grateful for your written confirmation by <b>{formatDate(reply)}</b>. If we do not receive it by then, your offer will be treated as withdrawn at the end of its current validity.</p>
        <p className="mt-6">Yours faithfully,</p>
        <div className="mt-14 w-64 border-t border-ink pt-1 text-sm">Procurement department<br />{r.facility ?? ""}</div>
        <p className="no-print mt-8 text-xs text-muted">Draft prepared by {me.name}. Check it against Law 182/2018 art. 27 and the tender conditions before sending.</p>
      </article>
    </>
  );
}

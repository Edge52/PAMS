/**
 * Award timeline of an approved award (Law 182/2018 art. 39): approval → bidders notified, complaint period →
 * acceptance notice to the winner. Server component, shown on the offer page and the project's Committees tab.
 */
import Link from "next/link";
import { Badge, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { recordAcceptanceNotice } from "@/app/procurement/offers/actions";
import { daysUntil, formatDate, todayISO } from "@/lib/format";

type Offer = {
  id: number; reference: string; awardApprovedOn: string | null; complaintUntil: string | null; acceptanceDue: string | null; acceptedOn: string | null;
};

export function AwardTimeline({ offer, supplier, canRecord, linkOffer = false }: { offer: Offer; supplier: string; canRecord: boolean; linkOffer?: boolean }) {
  if (!offer.awardApprovedOn) return null;
  const today = todayISO();
  const inComplaints = offer.complaintUntil != null && today <= offer.complaintUntil;
  const overdue = !offer.acceptedOn && offer.acceptanceDue != null && today > offer.acceptanceDue;
  const steps: { label: string; date: string | null; state: "done" | "now" | "next"; note?: string }[] = [
    { label: "Award approved by the competent authority", date: offer.awardApprovedOn, state: "done", note: "Notify every bidder of the result now." },
    { label: "Complaint period ends", date: offer.complaintUntil, state: inComplaints ? "now" : "done",
      note: inComplaints ? `${daysUntil(offer.complaintUntil)} day(s) left for complaints.` : undefined },
    { label: `Acceptance notice to ${supplier}`, date: offer.acceptedOn ?? offer.acceptanceDue,
      state: offer.acceptedOn ? "done" : inComplaints ? "next" : "now",
      note: offer.acceptedOn ? `Sent ${formatDate(offer.acceptedOn)}.` : `Due by ${formatDate(offer.acceptanceDue)}.` },
  ];
  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">Award timeline {linkOffer && <Link href={`/procurement/offers/${offer.id}`} className="text-sm font-normal text-primary hover:underline">{supplier} · {offer.reference}</Link>}
      {overdue ? <Badge tone="danger">Acceptance notice overdue</Badge> : offer.acceptedOn ? <Badge tone="ok">Winner notified</Badge> : null}</span>}>
      <ol className="space-y-3 text-sm">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${s.state === "done" ? "bg-ok" : s.state === "now" ? "bg-warn" : "bg-line"}`} />
            <span><span className="font-semibold">{s.label}</span> <span className="text-muted">{formatDate(s.date)}</span>
              {s.note && <span className="block text-xs text-muted">{s.note}</span>}</span>
          </li>
        ))}
      </ol>
      {!offer.acceptedOn && canRecord && (
        <ActionForm action={recordAcceptanceNotice} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <input type="hidden" name="offerId" value={offer.id} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">Date sent</span>
            <input type="date" name="sentOn" defaultValue={today} max={today} className="rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-sm" />
          </label>
          <SubmitButton variant={inComplaints ? "secondary" : "primary"}>Record acceptance notice sent</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-3 text-xs text-muted">Law 182/2018 art. 39: bidders are notified after the approval and have the complaint period to object; the winner is then notified of acceptance. Periods follow the settings.</p>
    </Panel>
  );
}

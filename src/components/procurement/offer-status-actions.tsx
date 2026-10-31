import { recommendAward, setOfferStatus } from "@/app/procurement/offers/actions";
import { offerActions, type OfferStatus } from "@/lib/procurement/labels";
import { ActionForm, SubmitButton } from "./action-form";

/**
 * Shortlist / recommend award / reject buttons for an offer. Reject asks for a reason. "Recommend award" sends the
 * offer to the adjudication committee and the competent authority for approval; it takes a justification (required
 * when a mandatory item fails). Buttons the user's role can't use are not shown.
 */
export function OfferStatusActions({ offerId, status, compact = false, exclude = [], allow, awardPending = false }: {
  offerId: number; status: OfferStatus; compact?: boolean; exclude?: OfferStatus[];
  /** What the signed-in user may do (offers.edit, award.recommend). */
  allow: { edit: boolean; recommend: boolean };
  /** An award recommendation for this offer is waiting for approval. */
  awardPending?: boolean;
}) {
  const actions = offerActions(status).filter((a) => !exclude.includes(a.to)).filter((a) =>
    a.to === "AWARDED" || status === "AWARDED" ? allow.recommend : allow.edit);
  const simple = actions.filter((a) => a.to !== "REJECTED" && a.to !== "AWARDED");
  const reject = actions.find((a) => a.to === "REJECTED");
  const award = actions.find((a) => a.to === "AWARDED");
  const popover = "absolute right-0 z-10 mt-1 w-80 space-y-2 rounded-[var(--radius-panel)] border border-line bg-surface p-3 text-sm shadow-lg";
  const summary = (tone: string) => `cursor-pointer list-none rounded-[var(--radius-control)] border font-semibold ${tone} ${compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"}`;
  if (awardPending) {
    return <p className={`${compact ? "text-xs" : "text-sm"} font-semibold text-warn`}>Award recommendation waiting for approval</p>;
  }
  if (!simple.length && !reject && !award) return compact ? <span className="text-xs text-faint">—</span> : <p className="text-sm text-muted">No decisions open to your role.</p>;
  return (
    <div className={`flex flex-wrap items-start gap-2 ${compact ? "text-xs" : ""}`}>
      {simple.map((a) => (
        <ActionForm key={a.to} action={setOfferStatus}
          confirm={a.to === "WITHDRAWN" ? "Mark this offer as withdrawn by the supplier?" : a.to === "SHORTLISTED" && status === "AWARDED" ? "Revoke the award? The offer goes back to the shortlist and the award approval no longer counts." : undefined}>
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="status" value={a.to} />
          <SubmitButton variant={a.tone} pendingLabel="…" className={compact ? "px-2 py-1 text-xs" : undefined}>{a.label}</SubmitButton>
        </ActionForm>
      ))}
      {award && (
        <details className="relative">
          <summary className={summary("border-primary bg-primary text-white hover:bg-primary-strong")}>Recommend award…</summary>
          <ActionForm action={recommendAward} className={popover}>
            <input type="hidden" name="offerId" value={offerId} />
            <p className="text-muted">The adjudication committee&apos;s voting members sign the recommendation, then the competent authority approves it (Law 182/2018 art. 35). The offer is awarded only then; prices and compliance are locked meanwhile.</p>
            <label className="block">
              <span className="mb-1 block font-semibold">Justification</span>
              <textarea name="reason" rows={2} className="w-full rounded-[var(--radius-control)] border border-line px-2 py-1 text-sm focus:border-primary focus:outline-none"
                placeholder="Required if the offer fails a mandatory item" />
            </label>
            <SubmitButton variant="primary">Send recommendation for approval</SubmitButton>
          </ActionForm>
        </details>
      )}
      {reject && (
        <details className="relative">
          <summary className={summary("border-line bg-surface text-danger hover:bg-danger-soft")}>Reject…</summary>
          <ActionForm action={setOfferStatus} className={popover}>
            <input type="hidden" name="offerId" value={offerId} />
            <input type="hidden" name="status" value="REJECTED" />
            <label className="block">
              <span className="mb-1 block font-semibold">Reason for rejection</span>
              <textarea name="reason" required rows={2} className="w-full rounded-[var(--radius-control)] border border-line px-2 py-1 text-sm focus:border-primary focus:outline-none"
                placeholder="e.g. Fails mandatory battery requirement" />
            </label>
            <SubmitButton variant="danger">Reject offer</SubmitButton>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

/**
 * The approval chain of one record (PO, BOQ or award), with Approve / Reject for the signed-in user when the engine
 * allows them to decide the open step. Server component; reuse it on any page:
 *   <ApprovalPanel entity="PO" entityId={po.id} returnPath={`/procurement/purchase-orders/${po.id}`} />
 */
import type { ReactNode } from "react";
import { Badge, Panel, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { recordPaperSignatureAction, decideApprovalStep } from "@/app/approvals/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { canRecordPaper, isMemberStep, type ApprovalEntity, type StepStatus } from "@/lib/approvals/core";
import { getApprovalFor, roleLabel, verdictFor } from "@/lib/approvals/server";
import { awardChairs } from "@/lib/approvals/effects";
import { formatMoney } from "@/lib/format";

const STEP_TONE: Record<StepStatus, Tone> = { WAITING: "neutral", PENDING: "warn", APPROVED: "ok", REJECTED: "danger", SKIPPED: "neutral" };
const STEP_TEXT: Record<StepStatus, string> = { WAITING: "Waiting", PENDING: "Waiting for decision", APPROVED: "Approved", REJECTED: "Rejected", SKIPPED: "Not needed" };
const REQ_TONE: Record<string, Tone> = { PENDING: "warn", APPROVED: "ok", REJECTED: "danger", CANCELLED: "neutral" };
const REQ_TEXT: Record<string, string> = { PENDING: "In progress", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Withdrawn" };

const when = (d: Date | null) => d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export async function ApprovalPanel({ entity, entityId, returnPath, title = "Approval", empty, actions }: {
  entity: ApprovalEntity; entityId: number; returnPath: string; title?: string;
  /** Shown when the record was never submitted. */
  empty?: ReactNode;
  /** Extra controls under the chain (e.g. "Withdraw from approval"). */
  actions?: ReactNode;
}) {
  const [view, me] = await Promise.all([getApprovalFor(entity, entityId), getCurrentUser()]);
  if (!view) {
    return empty ? <Panel title={title}><div className="text-sm text-muted">{empty}</div></Panel> : null;
  }
  const { request, steps } = view;
  const chairs = entity === "AWARD" ? await awardChairs(entityId) : [];
  const orders = [...new Set(steps.map((s) => s.stepOrder))].sort((a, b) => a - b);
  const memberWord = (s: (typeof steps)[number]) => isMemberStep(s) ? "Signed" : "Approved";

  const verdicts = new Map<number, { decide: boolean; paper: boolean; reason?: string }>();
  if (me) {
    for (const s of steps.filter((x) => x.status === "PENDING")) {
      const v = await verdictFor(s, request, steps, me, chairs);
      const paper = canRecordPaper(s, me, request.status).ok;
      verdicts.set(s.id, { decide: v.ok, paper, reason: v.ok ? undefined : v.reason });
    }
  }

  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">{title} <Badge tone={REQ_TONE[request.status]}>{REQ_TEXT[request.status]}</Badge></span>} padded={false}>
      <div className="border-b border-line px-4 py-3 text-sm">
        <p>Submitted by <strong>{request.requestedByName ?? "—"}</strong> · {when(request.requestedAt)}
          {request.amountEgp != null && <> · {formatMoney(request.amountEgp, "EGP")}</>}</p>
        {request.note && <p className="mt-1 whitespace-pre-line text-muted">{request.note}</p>}
      </div>
      {steps.length === 0 ? <p className="px-4 py-3 text-sm text-muted">No approval steps were needed.</p> : (
        <ol className="divide-y divide-line">
          {orders.map((o, i) => {
            const group = steps.filter((s) => s.stepOrder === o);
            return (
              <li key={o} className="px-4 py-3">
                <p className="mb-2 text-xs font-semibold text-muted">Step {i + 1}{group.length > 1 ? ` · ${group.length} people sign together` : ""}</p>
                <ul className="space-y-3">
                  {group.map((s) => {
                    const v = verdicts.get(s.id);
                    const whoText = isMemberStep(s)
                      ? (s.approverUserId ? "Signs in the app" : "No account — signs on paper")
                      : `Any ${roleLabel(s.approverRole)?.toLowerCase()}`;
                    return (
                      <li key={s.id} className="text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span><span className="font-semibold">{s.label}</span><span className="block text-xs text-muted">{whoText}</span></span>
                          <Badge tone={STEP_TONE[s.status]}>{s.status === "APPROVED" ? memberWord(s) : STEP_TEXT[s.status]}</Badge>
                        </div>
                        {(s.decidedByName || s.comment) && (
                          <p className="mt-1 text-xs text-muted">
                            {s.decidedByName && <>{s.status === "REJECTED" ? "Rejected" : memberWord(s)} by {s.decidedByName} · {when(s.decidedAt)}</>}
                            {s.comment && <span className="mt-0.5 block whitespace-pre-line text-ink">“{s.comment}”</span>}
                          </p>
                        )}
                        {v?.decide && (
                          <ActionForm action={decideApprovalStep} className="mt-2 space-y-2 rounded-[var(--radius-control)] border border-primary bg-primary-soft p-3">
                            <input type="hidden" name="stepId" value={s.id} />
                            <input type="hidden" name="returnPath" value={returnPath} />
                            <label className="block">
                              <span className="mb-1 block text-xs font-semibold">Comment <span className="font-normal text-muted">(required to reject)</span></span>
                              <textarea name="comment" rows={2} className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none" />
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <SubmitButton name="decision" value="APPROVED">{isMemberStep(s) ? "Sign recommendation" : "Approve"}</SubmitButton>
                              <SubmitButton name="decision" value="REJECTED" variant="danger">Reject</SubmitButton>
                            </div>
                          </ActionForm>
                        )}
                        {v?.paper && (
                          <ActionForm action={recordPaperSignatureAction} className="mt-2 flex flex-wrap items-end gap-2 rounded-[var(--radius-control)] border border-line bg-sunken p-3">
                            <input type="hidden" name="stepId" value={s.id} />
                            <input type="hidden" name="returnPath" value={returnPath} />
                            <label className="min-w-0 flex-1 basis-48">
                              <span className="mb-1 block text-xs font-semibold">Signed minutes reference <span className="font-normal text-muted">(optional)</span></span>
                              <input name="reference" className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-sm focus:border-primary focus:outline-none" placeholder="e.g. Minutes no. 3, page 4" />
                            </label>
                            <SubmitButton variant="secondary">Record paper signature</SubmitButton>
                          </ActionForm>
                        )}
                        {s.status === "PENDING" && v && !v.decide && !v.paper && v.reason && me && (s.approverUserId === me.id || s.approverRole === me.role) && (
                          <p className="mt-1 text-xs text-warn">{v.reason}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
      {actions && <div className="border-t border-line px-4 py-3">{actions}</div>}
    </Panel>
  );
}

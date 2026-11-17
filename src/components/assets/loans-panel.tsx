import Link from "next/link";
import { Badge, LinkButton, Panel } from "@/components/ui";
import { loansForAsset } from "@/lib/assets/loans-server";
import { CHECK_LABELS, checkState, DIRECTION_LABELS, LOAN_STATE_LABELS, LOAN_STATE_TONE, loanState } from "@/lib/assets/loans";
import { formatDate, todayISO } from "@/lib/format";

/** Loans of one device (wave 27): lent out, or a borrowed device that is in the register. Server component. */
export async function LoansPanel({ assetId, canEdit }: { assetId: number; canEdit: boolean }) {
  const loans = await loansForAsset(assetId);
  const today = todayISO();
  if (!loans.length && !canEdit) return null;
  return (
    <Panel title="Loans" padded={false}
      actions={canEdit ? <LinkButton href={`/assets/loans/new?assetId=${assetId}`} variant="ghost">Record a loan</LinkButton> : undefined}>
      {loans.length === 0 ? <p className="p-5 text-sm text-muted">Never lent or borrowed.</p> : (
        <ul className="divide-y divide-line">
          {loans.map((l) => {
            const st = loanState(l, today), ck = checkState(l);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                <Link href={`/assets/loans/${l.id}`} className="font-semibold text-primary hover:underline">{l.number}</Link>
                <span className="min-w-0 flex-1">{DIRECTION_LABELS[l.direction]} {l.otherParty} · {formatDate(l.outOn)}{l.returnedOn ? ` to ${formatDate(l.returnedOn)}` : l.dueBackOn ? `, due back ${formatDate(l.dueBackOn)}` : ""}</span>
                <Badge tone={LOAN_STATE_TONE[st]}>{LOAN_STATE_LABELS[st]}</Badge>
                {ck !== "NOT_NEEDED" && st !== "RETURNED" && <Badge tone={ck === "FIT" ? "ok" : ck === "NOT_FIT" ? "danger" : "warn"}>{CHECK_LABELS[ck]}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, Table, Td, Th, THead, type Tone } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { pendingForUser, recentDecisions, requestedBy } from "@/lib/approvals/server";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const KIND: Record<string, string> = { PO: "Purchase order", BOQ: "BOQ", AWARD: "Award", DISPOSAL: "Disposal" };
const REQ_TONE: Record<string, Tone> = { PENDING: "warn", APPROVED: "ok", REJECTED: "danger", CANCELLED: "neutral" };
const REQ_TEXT: Record<string, string> = { PENDING: "In progress", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Withdrawn" };

export default async function ApprovalsPage() {
  // Everyone signed in can open this page; it only lists what the engine lets this user decide or see.
  const me = await requireUser();
  const [waiting, mine, recent] = await Promise.all([pendingForUser(me), requestedBy(me), recentDecisions(me)]);

  return (
    <>
      <PageHeader title="Approvals" description="Purchase orders, BOQs and award recommendations waiting for a decision, and what happened to the ones you submitted." />

      <section className="mb-6" aria-labelledby="waiting-h">
        <h2 id="waiting-h" className="mb-3 text-lg font-bold">Waiting for you {waiting.length > 0 && <Badge tone="warn">{waiting.length}</Badge>}</h2>
        {waiting.length === 0 ? (
          <EmptyState title="Nothing waits for your decision">When a request reaches a step you approve, it appears here and in your notifications.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Request</Th><Th>Type</Th><Th>Your step</Th><Th align="right">Value</Th><Th>Submitted</Th><Th /></tr></THead>
            <tbody>
              {waiting.map(({ request: r, step, mode }) => (
                <tr key={step.id}>
                  <Td className="min-w-56"><Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link></Td>
                  <Td>{KIND[r.entity]}</Td>
                  <Td>{step.label}{mode === "paper" && <span className="block text-xs text-muted">Record the signature from the signed minutes</span>}</Td>
                  <Td align="right" className="whitespace-nowrap">{r.amountEgp != null ? formatMoney(r.amountEgp, "EGP") : "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.requestedAt)}</Td>
                  <Td><Link href={r.href} className="whitespace-nowrap text-sm font-semibold text-primary hover:underline">{mode === "paper" ? "Record signature" : "Review and decide"}</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="You requested" padded={false}>
          {mine.length === 0 ? <p className="p-4 text-sm text-muted">You haven&apos;t submitted anything for approval. Submit a purchase order, a BOQ or an award recommendation from its page.</p> : (
            <ul className="divide-y divide-line">
              {mine.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0"><Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link>
                    <span className="block text-xs text-muted">{KIND[r.entity]} · submitted {formatDate(r.requestedAt)}{r.decidedAt ? ` · closed ${formatDate(r.decidedAt)}` : ""}</span></span>
                  <Badge tone={REQ_TONE[r.status]}>{REQ_TEXT[r.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent decisions" padded={false}>
          {recent.length === 0 ? <p className="p-4 text-sm text-muted">No decisions recorded yet.</p> : (
            <ul className="divide-y divide-line">
              {recent.map(({ step, request: r, decidedByName }) => (
                <li key={step.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link>
                    <Badge tone={step.status === "APPROVED" ? "ok" : "danger"}>{step.status === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                  </div>
                  <span className="block text-xs text-muted">{step.label} · {decidedByName ?? "—"} · {formatDate(step.decidedAt)}</span>
                  {step.comment && <span className="mt-0.5 block text-xs">“{step.comment}”</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

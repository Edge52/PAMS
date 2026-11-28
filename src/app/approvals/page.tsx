import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, Table, Td, Th, THead, type Tone } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { pendingForUser, recentDecisions, requestedBy } from "@/lib/approvals/server";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { trackingFor } from "@/lib/approvals/delegation-server";
import { holidayDatesBy } from "@/lib/holidays-server";
import { workingDaysBetween } from "@/lib/working-days";
import { HIDDEN_PRICE, opensFor, seesPrices } from "@/lib/auth/prices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

const KIND: Record<string, string> = { PO: "Purchase order", BOQ: "BOQ", AWARD: "Award", DISPOSAL: "Disposal", EQUIPMENT_PLAN: "Equipment plan" };
const REQ_TONE: Record<string, Tone> = { PENDING: "warn", APPROVED: "ok", REJECTED: "danger", CANCELLED: "neutral" };
const REQ_TEXT: Record<string, string> = { PENDING: "In progress", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Withdrawn" };

export default async function ApprovalsPage() {
  // Everyone signed in can open this page; it only lists what the engine lets this user decide or see.
  const me = await requireUser();
  const [waiting, mine, recent] = await Promise.all([pendingForUser(me), requestedBy(me), recentDecisions(me)]);
  // Wave 41: when each step started waiting, whether it was escalated, and whom a deputy decided for.
  const tracked = await trackingFor([...waiting.map((w) => w.step.id), ...recent.map((r) => r.step.id)]);
  const today = todayISO();
  // Wave 43: public holidays don't count as days waited.
  const sinceOf = (stepId: number, requestedAt: Date) => tracked.get(stepId)?.pendingSince ?? requestedAt;
  const earliest = waiting.map((w) => todayISO(sinceOf(w.step.id, w.request.requestedAt))).sort()[0] ?? today;
  const hols = await holidayDatesBy(waiting.map((w) => w.request.facilityId), earliest, today);

  return (
    <>
      <PageHeader title="Approvals" description="Purchase orders, BOQs and award recommendations waiting for a decision, and what happened to the ones you submitted." />
      <p className="-mt-2 mb-4 text-sm text-muted">Going away? <Link href="/account/notifications" className="font-semibold text-primary hover:underline">Name a deputy</Link> to decide your approvals while you are out.</p>

      <section className="mb-6" aria-labelledby="waiting-h">
        <h2 id="waiting-h" className="mb-3 text-lg font-bold">Waiting for you {waiting.length > 0 && <Badge tone="warn">{waiting.length}</Badge>}</h2>
        {waiting.length === 0 ? (
          <EmptyState title="Nothing waits for your decision">When a request reaches a step you approve, it appears here and in your notifications.</EmptyState>
        ) : (
          <Table>
            <THead><tr><Th>Request</Th><Th>Type</Th><Th>Your step</Th><Th align="right">Value</Th><Th>Waiting since</Th><Th /></tr></THead>
            <tbody>
              {waiting.map(({ request: r, step, mode, forName }) => {
                const t = tracked.get(step.id);
                const since = t?.pendingSince ?? r.requestedAt;
                const days = workingDaysBetween(todayISO(since), today, hols(r.facilityId));
                return (
                <tr key={step.id}>
                  <Td className="min-w-56">{opensFor(me.role, r.href) ? <Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link> : <span className="font-semibold">{r.title}</span>}</Td>
                  <Td>{KIND[r.entity]}</Td>
                  <Td>{step.label}{mode === "paper" && <span className="block text-xs text-muted">Record the signature from the signed minutes</span>}
                    {forName && <span className="block text-xs text-muted">As deputy for {forName}</span>}</Td>
                  <Td align="right" className="whitespace-nowrap">{r.amountEgp == null ? "—" : seesPrices(me.role) ? formatMoney(r.amountEgp, "EGP") : HIDDEN_PRICE}</Td>
                  <Td className="whitespace-nowrap">{formatDate(since)}
                    <span className="block text-xs text-muted">{days === 0 ? "today" : `${days} working day${days === 1 ? "" : "s"}`}</span>
                    {(t?.level ?? 0) >= 2 ? <Badge tone="danger">Escalated</Badge> : (t?.level ?? 0) === 1 ? <Badge tone="warn">Reminded</Badge> : null}</Td>
                  <Td>{opensFor(me.role, r.href) && <Link href={r.href} className="whitespace-nowrap text-sm font-semibold text-primary hover:underline">{mode === "paper" ? "Record signature" : "Review and decide"}</Link>}</Td>
                </tr>
                );
              })}
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
                  <span className="min-w-0">{opensFor(me.role, r.href) ? <Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link> : <span className="font-semibold">{r.title}</span>}
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
                    {opensFor(me.role, r.href) ? <Link href={r.href} className="font-semibold text-primary hover:underline">{r.title}</Link> : <span className="font-semibold">{r.title}</span>}
                    <Badge tone={step.status === "APPROVED" ? "ok" : "danger"}>{step.status === "APPROVED" ? "Approved" : "Rejected"}</Badge>
                  </div>
                  <span className="block text-xs text-muted">{step.label} · {decidedByName ?? "—"}{tracked.get(step.id)?.decidedForName ? ` for ${tracked.get(step.id)?.decidedForName}` : ""} · {formatDate(step.decidedAt)}</span>
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

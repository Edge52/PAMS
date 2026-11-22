/**
 * Clarifications and addenda register on the RFQ page (wave 37, Law 182/2018 art. 19). Server component; rules in
 * src/lib/procurement/clarifications.ts, actions in src/app/procurement/rfqs/clarification-actions.ts.
 */
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers, tenderAddenda, tenderClarifications } from "@/db/schema";
import { Badge, Field, FormGrid, Input, Panel, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { formatDate, todayISO } from "@/lib/format";
import { addendumLabel, answerWarnings, nextAddendumNumber, registerCounts } from "@/lib/procurement/clarifications";
import { emailStatus } from "@/lib/notifications/email";
import {
  addAddendumAction, addQuestionAction, answerQuestionAction, deleteQuestionAction, emailNoticeAction,
} from "@/app/procurement/rfqs/clarification-actions";

export async function ClarificationsPanel({ rfq, invited, mayEdit, technicalOpened }: {
  rfq: { id: number; closingDate: string | null; status: string };
  invited: { supplierId: number; name: string }[];
  mayEdit: boolean; technicalOpened: boolean;
}) {
  const [qs, ads, mail] = await Promise.all([
    db.select({ q: tenderClarifications, supplier: suppliers.name }).from(tenderClarifications)
      .leftJoin(suppliers, eq(suppliers.id, tenderClarifications.supplierId))
      .where(eq(tenderClarifications.rfqId, rfq.id)).orderBy(asc(tenderClarifications.receivedOn), asc(tenderClarifications.id)),
    db.select().from(tenderAddenda).where(eq(tenderAddenda.rfqId, rfq.id)).orderBy(asc(tenderAddenda.number)),
    emailStatus(),
  ]);
  const c = registerCounts(qs.map((x) => x.q));
  const today = todayISO();
  const next = nextAddendumNumber(ads.map((a) => a.number));
  const open = rfq.status !== "CANCELLED" && !technicalOpened;

  return (
    <Panel title={<span className="flex flex-wrap items-center gap-2">Clarifications and addenda <Badge>{c.questions} question{c.questions === 1 ? "" : "s"}</Badge>
      {c.open > 0 && <Badge tone="warn">{c.open} not sent</Badge>}<Badge>{ads.length} addend{ads.length === 1 ? "um" : "a"}</Badge></span>}
      actions={<Link href={`/procurement/rfqs/${rfq.id}/notice`} target="_blank" className="text-sm text-primary hover:underline">Notice to all bidders</Link>}>
      <div className="space-y-5 text-sm">
        <p className="text-xs text-muted">Answers go to every invited supplier without saying who asked. Law 182/2018 art. 19: tell bidders within 3 days, at least 7 days before the technical opening; nothing changes after the opening.</p>

        <section>
          <h3 className="mb-2 font-semibold">Addenda</h3>
          {ads.length === 0 ? <p className="text-muted">No addenda yet.</p> : (
            <ul className="divide-y divide-line rounded border border-line">
              {ads.map((a) => (
                <li key={a.id} className="px-3 py-2">
                  <span className="font-semibold">{addendumLabel(a.number)}</span> · {formatDate(a.issuedOn)}
                  {a.extendsDeadline && <Badge tone="info">Extends the deadline</Badge>}
                  <p className="whitespace-pre-line">{a.summary}</p>
                  {a.extendsDeadline && <p className="text-xs text-muted">Closing date {a.previousClosingDate ? formatDate(a.previousClosingDate) : "not set"} → {formatDate(a.newClosingDate)}</p>}
                </li>
              ))}
            </ul>
          )}
          {mayEdit && open && (
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold text-primary">Record {addendumLabel(next)}</summary>
              <ActionForm action={addAddendumAction} className="mt-3 space-y-3"
                confirm={`Record ${addendumLabel(next)}? If you ticked "extends the deadline", the RFQ closing date changes now and every bidder must be told.`}>
                <input type="hidden" name="rfqId" value={rfq.id} />
                <FormGrid cols={2}>
                  <Field label="Date"><Input type="date" name="issuedOn" defaultValue={today} required /></Field>
                  <Field label="New closing date" hint={`Only if it extends the deadline. Now: ${rfq.closingDate ? formatDate(rfq.closingDate) : "not set"}.`}>
                    <Input type="date" name="newClosingDate" min={rfq.closingDate ?? undefined} />
                  </Field>
                </FormGrid>
                <Field label="What changes"><Textarea name="summary" required maxLength={4000} placeholder="e.g. Item 3: quantity 6 → 8; spec clause 4.2 reworded." /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" name="extendsDeadline" className="size-4 accent-[var(--color-primary)]" />It extends the submission deadline</label>
                <SubmitButton variant="secondary">Record addendum</SubmitButton>
              </ActionForm>
            </details>
          )}
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Questions from bidders</h3>
          {qs.length === 0 ? <p className="text-muted">No questions yet.</p> : (
            <ol className="space-y-3">
              {qs.map(({ q, supplier }, i) => {
                const warn = q.sentOn ? answerWarnings({ receivedOn: q.receivedOn, sentOn: q.sentOn, closingDate: rfq.closingDate }) : [];
                return (
                  <li key={q.id} className="rounded border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span>Q{i + 1} · received {formatDate(q.receivedOn)} · from {supplier ?? "a bidder"} <span className="italic">(not shown to bidders)</span></span>
                      {q.sentOn ? <Badge tone="ok">Sent {formatDate(q.sentOn)}</Badge> : q.answer ? <Badge tone="warn">Answer not sent</Badge> : <Badge tone="warn">No answer</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-line font-semibold">{q.question}</p>
                    {q.answer && <p className="mt-1 whitespace-pre-line">{q.answer}</p>}
                    {warn.map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
                    {mayEdit && !q.sentOn && (
                      <div className="mt-2 space-y-2">
                        <ActionForm action={answerQuestionAction} className="space-y-2">
                          <input type="hidden" name="id" value={q.id} />
                          <Field label="Answer"><Textarea name="answer" defaultValue={q.answer ?? ""} required maxLength={4000} /></Field>
                          <Field label="Sent to all bidders on" hint="Leave empty to save a draft."><Input type="date" name="sentOn" max={today} /></Field>
                          <SubmitButton variant="secondary">Save answer</SubmitButton>
                        </ActionForm>
                        <ActionForm action={deleteQuestionAction} confirm="Remove this question from the register?">
                          <input type="hidden" name="id" value={q.id} />
                          <button className="text-xs text-danger hover:underline">Remove question</button>
                        </ActionForm>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {mayEdit && open && (
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold text-primary">Record a question</summary>
              <ActionForm action={addQuestionAction} className="mt-3 space-y-3">
                <input type="hidden" name="rfqId" value={rfq.id} />
                <FormGrid cols={2}>
                  <Field label="From"><Select name="supplierId" placeholder="Not recorded" options={invited.map((s) => ({ value: s.supplierId, label: s.name }))} /></Field>
                  <Field label="Received on"><Input type="date" name="receivedOn" defaultValue={today} max={today} required /></Field>
                </FormGrid>
                <Field label="Question"><Textarea name="question" required maxLength={4000} /></Field>
                <SubmitButton variant="secondary">Record question</SubmitButton>
              </ActionForm>
            </details>
          )}
        </section>

        {mayEdit && mail.active && (qs.some((x) => x.q.sentOn) || ads.length > 0) && (
          <ActionForm action={emailNoticeAction} confirm="Email the notice to every invited supplier with an email address? Each gets their own message.">
            <input type="hidden" name="rfqId" value={rfq.id} />
            <SubmitButton variant="secondary">Email the notice to all bidders</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}

/**
 * Procurement method and tender timetable (wave 37) on the project's Tender tab, plus a short summary for the
 * Overview. Server components; rules in src/lib/procurement/timetable.ts.
 */
import Link from "next/link";
import type { projects } from "@/db/schema";
import { Badge, Details, Field, Input, Panel, Select, Table, Td, Textarea, Th, THead } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { formatDate, todayISO } from "@/lib/format";
import { loadTimetable, projectClarificationCounts } from "@/lib/procurement/timetable-server";
import {
  ANSWER_LEAD_DAYS, LEGAL_DAYS_NOTE, METHOD_LABELS, METHOD_LAW, needsJustification, PROCUREMENT_METHODS, STEP_LABELS, STEP_SOURCE, stateLabel,
} from "@/lib/procurement/timetable";
import { saveMethodAction, saveTimetableAction, suggestDatesAction } from "@/app/procurement/timetable-actions";

type Project = typeof projects.$inferSelect;

export async function MethodAndTimetable({ project: p, canEdit }: { project: Project; canEdit: boolean }) {
  const today = todayISO();
  const t = await loadTimetable(p, today);
  const overdue = t.rows.filter((r) => r.state.kind === "overdue").length;
  const late = t.rows.filter((r) => r.state.kind === "late").length;
  const missingReason = needsJustification(t.method) && !p.methodJustification;

  return (
    <>
      <Panel title="Procurement method" actions={<Badge tone={p.procurementMethod ? "info" : "neutral"}>{METHOD_LABELS[t.method]}{p.procurementMethod ? "" : " (not set)"}</Badge>}>
        <Details items={[
          { label: "Method", value: <>{METHOD_LABELS[t.method]}<span className="block text-xs text-muted">Law 182/2018 {METHOD_LAW[t.method]}</span></> },
          { label: "Reason for this method", value: p.methodJustification ? <span className="whitespace-pre-line">{p.methodJustification}</span> : needsJustification(t.method) ? <span className="text-danger">Missing</span> : "Not needed for a public tender" },
          { label: "Approved by", value: p.approvingAuthority },
          { label: "Urgent", value: t.urgent ? <>Yes<span className="block whitespace-pre-line text-xs text-muted">{t.urgentReason}</span></> : "No" },
          { label: "Days to the envelope opening", value: <>Legal minimum {t.legalDays} days{t.urgent ? " (urgent)" : ""}; planned with {t.planDays} days<span className="block text-xs text-muted">{LEGAL_DAYS_NOTE}</span></> },
        ]} />
        {missingReason && <p className="mt-3 text-sm text-danger">Any method other than a public tender needs a reasoned decision of the competent authority (art. 7). Record the reason.</p>}
        {canEdit && (
          <details className="mt-4 border-t border-line pt-3" open={missingReason}>
            <summary className="cursor-pointer text-sm font-semibold text-primary">Change the method</summary>
            <ActionForm action={saveMethodAction} className="mt-3 space-y-3">
              <input type="hidden" name="projectId" value={p.id} />
              <Field label="Method">
                <Select name="method" defaultValue={t.method} options={PROCUREMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
              </Field>
              <Field label="Reason (needed for every method except a public tender)" hint="The justification in the competent authority's decision, e.g. the urgency or the sole maker.">
                <Textarea name="justification" defaultValue={p.methodJustification ?? ""} maxLength={4000} />
              </Field>
              <Field label="Approved by" hint="Who approved the method, e.g. the hospital director, with the decision number and date.">
                <Input name="approvingAuthority" defaultValue={p.approvingAuthority ?? ""} maxLength={300} />
              </Field>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="urgent" defaultChecked={t.urgent} className="mt-1" />
                <span>Urgent<span className="block text-xs text-muted">The shorter legal minimum days apply (for example 14 instead of 20 for a public tender). Needs a reason.</span></span></label>
              <Field label="Reason it is urgent" hint="The competent authority's decision and why the normal period can't be kept.">
                <Textarea name="urgentReason" defaultValue={t.urgentReason ?? ""} maxLength={2000} rows={2} />
              </Field>
              <SubmitButton variant="secondary">Save method</SubmitButton>
            </ActionForm>
          </details>
        )}
      </Panel>

      <Panel title="Timetable" padded={false} actions={<span className="flex gap-2">
        {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
        {late > 0 && <Badge tone="warn">{late} late</Badge>}
        {t.problems.length > 0 && <Badge tone="warn">{t.problems.length} to check</Badge>}
      </span>}>
        <ActionForm action={saveTimetableAction}>
          <input type="hidden" name="projectId" value={p.id} />
          <Table className="rounded-none border-0">
            <THead><tr><Th>Step</Th><Th>Planned</Th><Th>Actual</Th><Th>Status</Th>{canEdit && <Th>Notes</Th>}</tr></THead>
            <tbody>
              {t.rows.map((r) => {
                const st = stateLabel(r.state);
                return (
                  <tr key={r.step}>
                    <Td><span className="font-semibold">{STEP_LABELS[r.step]}</span>
                      {r.problems.map((x) => <span key={x} className="block max-w-xs text-xs text-warn">{x}</span>)}</Td>
                    <Td className="whitespace-nowrap">{canEdit
                      ? <Input type="date" name={`planned_${r.step}`} defaultValue={r.planned ?? ""} aria-label={`${STEP_LABELS[r.step]}: planned`} />
                      : formatDate(r.planned)}</Td>
                    <Td className="whitespace-nowrap">{r.fromApp
                      ? <>{formatDate(r.actual)}<span className="block text-xs text-muted">From the app: {STEP_SOURCE[r.step]}</span></>
                      : canEdit ? <Input type="date" name={`actual_${r.step}`} defaultValue={r.entered ?? ""} max={today} aria-label={`${STEP_LABELS[r.step]}: actual`} />
                        : formatDate(r.actual)}</Td>
                    <Td><Badge tone={st.tone}>{st.text}</Badge></Td>
                    {canEdit && <Td><Input name={`notes_${r.step}`} defaultValue={r.notes ?? ""} maxLength={500} aria-label={`${STEP_LABELS[r.step]}: notes`} /></Td>}
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {canEdit && <div className="flex flex-wrap items-center gap-3 border-t border-line p-4"><SubmitButton variant="secondary">Save timetable</SubmitButton></div>}
        </ActionForm>
        {canEdit && (
          <ActionForm action={suggestDatesAction} className="px-4 pb-4">
            <input type="hidden" name="projectId" value={p.id} />
            <SubmitButton variant="secondary">Suggest blank planned dates</SubmitButton>
            <p className="mt-1 text-xs text-muted">From the announcement date, {t.planDays} days to submission and the technical opening (never below the legal {t.legalDays}), answers {ANSWER_LEAD_DAYS} days before the opening and the {t.complaintDays}-day complaint period. Dates already planned are kept.</p>
          </ActionForm>
        )}
        <p className="border-t border-line px-4 py-3 text-xs text-muted">Dates the app already records (RFQ issue and closing, envelope openings, award approval, complaint period, first purchase order) fill the actual column by themselves. Overdue steps are sent to procurement as alerts.</p>
      </Panel>
    </>
  );
}

/** Overview summary: method, next planned step, overdue steps and open questions. */
export async function TimetableSummary({ project: p }: { project: Project }) {
  const today = todayISO();
  const [t, q] = await Promise.all([loadTimetable(p, today), projectClarificationCounts(p.id)]);
  const next = t.rows.find((r) => !r.actual && r.planned);
  const overdue = t.rows.filter((r) => r.state.kind === "overdue");
  const href = `/procurement/${p.id}?tab=tender`;
  return (
    <Panel title="Method and timetable" actions={<Link href={href} className="text-sm text-primary hover:underline">Open timetable</Link>}>
      <Details items={[
        { label: "Method", value: <>{METHOD_LABELS[t.method]}{!p.procurementMethod && <span className="text-xs text-muted"> (not set)</span>}</> },
        { label: "Next step", value: next ? <>{STEP_LABELS[next.step]} · {formatDate(next.planned)} <Badge tone={stateLabel(next.state).tone}>{stateLabel(next.state).text}</Badge></> : "Nothing planned" },
        { label: "Overdue steps", value: overdue.length ? <span className="text-danger">{overdue.map((r) => STEP_LABELS[r.step]).join(", ")}</span> : "None" },
        { label: "Bidder questions", value: q.questions ? `${q.questions} (${q.open} without an answer sent)` : "None" },
      ]} />
    </Panel>
  );
}

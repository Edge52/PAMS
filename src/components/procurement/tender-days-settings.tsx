/** Settings panel (wave 37): planning days from announcement to the technical opening per method; wave 39 legal minimums. */
import { Field, FormGrid, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { saveTenderDaysAction } from "@/app/admin/settings/tender-actions";
import { cleanMinDays, LEGAL_DAYS_NOTE, LEGAL_MIN_DAYS, LEGAL_MIN_DAYS_URGENT, METHOD_LABELS, PROCUREMENT_METHODS } from "@/lib/procurement/timetable";

export function TenderDaysSettings({ value }: { value: unknown }) {
  const d = cleanMinDays(value);
  return (
    <Panel title="Tender timetable">
      <ActionForm action={saveTenderDaysAction} className="space-y-3">
        <p className="text-sm text-muted">Planning days between the announcement (or invitation) and the technical envelope opening for each method. Suggested dates use them. They can&apos;t be below the legal minimum, which the timetable always checks (urgent tenders use the shorter urgent minimum).</p>
        <FormGrid cols={4}>
          {PROCUREMENT_METHODS.map((m) => (
            <Field key={m} label={`${METHOD_LABELS[m]} (days)`} hint={LEGAL_MIN_DAYS[m] ? `Legal minimum ${LEGAL_MIN_DAYS[m]}${LEGAL_MIN_DAYS_URGENT[m] < LEGAL_MIN_DAYS[m] ? `, urgent ${LEGAL_MIN_DAYS_URGENT[m]}` : ""}` : "No legal minimum"}>
              <Input type="number" min={LEGAL_MIN_DAYS[m]} max={365} step={1} name={`min_${m}`} defaultValue={d[m]} />
            </Field>
          ))}
        </FormGrid>
        <p className="text-xs text-muted">{LEGAL_DAYS_NOTE}</p>
        <SubmitButton>Save tender days</SubmitButton>
      </ActionForm>
    </Panel>
  );
}

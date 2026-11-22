/** Settings panel (wave 37): minimum days from announcement to bid submission per procurement method. */
import { Field, FormGrid, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { saveTenderDaysAction } from "@/app/admin/settings/tender-actions";
import { cleanMinDays, METHOD_LABELS, PROCUREMENT_METHODS } from "@/lib/procurement/timetable";

export function TenderDaysSettings({ value }: { value: unknown }) {
  const d = cleanMinDays(value);
  return (
    <Panel title="Tender timetable">
      <ActionForm action={saveTenderDaysAction} className="space-y-3">
        <p className="text-sm text-muted">Minimum days between the announcement (or invitation) and bid submission for each method. The project timetable flags a planned date shorter than this and uses it to suggest dates.</p>
        <FormGrid cols={4}>
          {PROCUREMENT_METHODS.map((m) => (
            <Field key={m} label={`${METHOD_LABELS[m]} (days)`}>
              <Input type="number" min={0} max={365} step={1} name={`min_${m}`} defaultValue={d[m]} />
            </Field>
          ))}
        </FormGrid>
        <p className="text-xs text-muted">The defaults are planning figures. Check them with your legal adviser against the executive regulations of Law 182/2018.</p>
        <SubmitButton>Save tender days</SubmitButton>
      </ActionForm>
    </Panel>
  );
}

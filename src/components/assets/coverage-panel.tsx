import Link from "next/link";
import { Field, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { coverageLabel, DAY_NAMES, DEFAULT_COVERAGE } from "@/lib/assets/coverage";
import { coverageFor } from "@/lib/assets/coverage-server";
import { saveCoverageAction } from "@/app/assets/contracts/coverage-actions";

/** A contract's covered hours (wave 38): uptime and downtime on the statement count only inside them. Server component. */
export async function CoveragePanel({ contractId, facilityId, canEdit }: { contractId: number; facilityId: number; canEdit: boolean }) {
  const cov = await coverageFor(contractId);
  const v = cov ?? { ...DEFAULT_COVERAGE, allHours: true };
  return (
    <Panel title="Covered hours">
      <p className="text-sm"><b>{coverageLabel(cov)}</b></p>
      <p className="mt-1 text-xs text-muted">The uptime guarantee and downtime on the monthly statement count only these hours (Cairo time). Response and repair times stay in clock hours.
        {" "}<Link href={`/assets/contracts/holidays?facilityId=${facilityId}`} className="text-primary hover:underline">Public holidays</Link></p>
      {canEdit && (
        <details className="mt-3 border-t border-line pt-3 text-sm">
          <summary className="cursor-pointer text-primary">Change covered hours</summary>
          <ActionForm action={saveCoverageAction} className="mt-3 space-y-3">
            <input type="hidden" name="contractId" value={contractId} />
            <label className="flex items-center gap-2"><input type="checkbox" name="allHours" defaultChecked={v.allHours} /> Round the clock (24/7)</label>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Days, if not round the clock</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1">{DAY_NAMES.map((d, i) => (
                <label key={d} className="flex items-center gap-1"><input type="checkbox" name="day" value={i} defaultChecked={v.days.includes(i)} />{d.slice(0, 3)}</label>
              ))}</div>
              <output name="day" />
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From"><Input name="fromTime" type="time" required defaultValue={v.fromTime} /></Field>
              <Field label="To" hint="Earlier than From = overnight. 00:00 = midnight."><Input name="toTime" type="time" required defaultValue={v.toTime === "24:00" ? "00:00" : v.toTime} /></Field>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" name="excludeHolidays" defaultChecked={v.excludeHolidays} /> Not on public holidays</label>
            <SubmitButton variant="secondary">Save covered hours</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

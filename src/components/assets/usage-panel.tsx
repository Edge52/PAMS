import Link from "next/link";
import { Badge, Field, FormGrid, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { NativeSelect } from "@/components/assets/bits";
import { meterHistory, type UsageInfo } from "@/lib/assets/meters-server";
import { USAGE_UNIT_LABELS, USAGE_UNITS, usageIntervalLabel, type UsageUnit } from "@/lib/assets/meters";
import { dueState } from "@/lib/assets/maintenance";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { addMeterReadingAction, setUsageIntervalAction } from "@/app/assets/meters/actions";

/** Usage meter of one device (wave 27): last reading, use per day, when usage-based PPM falls due, add a reading. */
export async function UsagePanel({ assetId, typeCode, usage, canRecord, disposed }: {
  assetId: number; typeCode: string; usage: UsageInfo; canRecord: boolean; disposed: boolean;
}) {
  const history = await meterHistory(assetId, 8);
  const today = todayISO();
  const state = dueState(usage.due, today);
  const unit = usage.unit;
  return (
    <Panel title={<span id="usage">Usage</span>}
      actions={state === "OVERDUE" ? <Badge tone="danger">Usage PPM overdue</Badge> : state === "DUE_SOON" ? <Badge tone="warn">Usage PPM due soon</Badge> : usage.due ? <Badge tone="ok">In date</Badge> : <Badge>No estimate yet</Badge>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Last reading</dt><dd className="font-semibold">{usage.lastReading ? `${formatNumber(usage.lastReading.reading)} ${unit}` : "None yet"}{usage.lastReading && <span className="block text-xs font-normal text-muted">{formatDate(usage.lastReading.date)}</span>}</dd></div>
        <div><dt className="text-xs text-muted">Average use</dt><dd className="font-semibold">{usage.perDay != null ? `${formatNumber(usage.perDay, usage.perDay < 10 ? 1 : 0)} ${unit} a day` : "—"}</dd></div>
        <div><dt className="text-xs text-muted">Since last PPM</dt><dd className="font-semibold">{formatNumber(Math.round(usage.usedSince))} of {formatNumber(usage.interval)} {unit}</dd></div>
        <div><dt className="text-xs text-muted">Usage PPM due</dt><dd className={`font-semibold ${state === "OVERDUE" ? "text-danger" : state === "DUE_SOON" ? "text-warn" : ""}`}>{usage.due ? formatDate(usage.due) : "—"}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-muted">
        Planned maintenance {usageIntervalLabel(usage.interval, unit)} (set on the <Link href={`/catalogue/${typeCode}`} className="text-primary hover:underline">device type</Link>), or by months, whichever comes first.
        {usage.countedFrom === "first_reading" && " Use is counted from the first reading: record a reading at each visit for an exact count."}
        {usage.fromImaging && " Taken from the monthly exam counts under Imaging use until the device has meter readings."}
        {!usage.due && usage.lastReading && " Two readings at least a day apart are needed to estimate a date."}
      </p>
      {history.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="min-h-6 cursor-pointer text-primary">Recent readings ({history.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="w-24 text-muted">{formatDate(h.readOn)}</span>
                <b>{formatNumber(h.reading)} {h.unit}</b>
                {h.kind === "RESET" && <Badge tone="info">New or reset meter</Badge>}
                <span className="text-muted">{h.enteredByName ?? ""}{h.note ? ` · ${h.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canRecord && !disposed && (
        <ActionForm action={addMeterReadingAction} className="mt-4 border-t border-line pt-3">
          <input type="hidden" name="assetId" value={assetId} />
          <FormGrid cols={3}>
            <Field label={`Meter reading (${unit})`}><Input type="number" name="reading" min={0} step="any" inputMode="decimal" required /></Field>
            <Field label="Read on"><Input type="date" name="readOn" defaultValue={today} max={today} required /></Field>
            <Field label="Note"><Input name="note" maxLength={500} /></Field>
          </FormGrid>
          <label className="mt-2 flex min-h-6 items-center gap-2 text-sm"><input type="checkbox" name="reset" className="size-5" /> The meter was reset or replaced (this is the new meter&apos;s first reading)</label>
          <div className="mt-3"><SubmitButton variant="secondary">Add reading</SubmitButton></div>
        </ActionForm>
      )}
    </Panel>
  );
}

/** Usage interval of a device type (wave 27), on the catalogue page. */
export function UsageIntervalPanel({ code, interval, unit, canEdit }: { code: string; interval: number | null; unit: string | null; canEdit: boolean }) {
  const label = usageIntervalLabel(interval, unit);
  return (
    <Panel title="Planned maintenance by use">
      <p className="mb-3 text-sm">{label ? <>Also due <b>{label}</b>, or by months, whichever comes first.</> : <span className="text-muted">By months only. Add a usage interval when the maker gives one by hours run, scans or cycles.</span>}</p>
      {canEdit && (
        <ActionForm action={setUsageIntervalAction}>
          <input type="hidden" name="code" value={code} />
          <FormGrid cols={2}>
            <Field label="Every" hint="Leave blank to plan by months only."><Input type="number" name="usageInterval" min={1} step={1} defaultValue={interval ?? ""} /></Field>
            <Field label="Of"><NativeSelect name="usageUnit" value={unit} placeholder="Choose…" options={USAGE_UNITS.map((u) => ({ value: u, label: `${u} (${USAGE_UNIT_LABELS[u as UsageUnit].toLowerCase()})` }))} /></Field>
          </FormGrid>
          <div className="mt-3"><SubmitButton variant="secondary">Save</SubmitButton></div>
        </ActionForm>
      )}
    </Panel>
  );
}

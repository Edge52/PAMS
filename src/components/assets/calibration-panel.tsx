import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { calibrations, deviceTypeCalibration } from "@/db/schema";
import { Badge, Field, FormGrid, Input, LinkButton, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { DEFAULT_CALIBRATION_MONTHS, CALIBRATION_RESULT_LABELS, CALIBRATION_RESULT_TONE, CALIBRATION_STATE_LABELS, CALIBRATION_STATE_TONE, calibrationState } from "@/lib/assets/calibration";
import { intervalFor } from "@/lib/assets/calibration-server";
import { formatDate, todayISO } from "@/lib/format";
import { setAssetCalibrationIntervalAction, setTypeCalibrationIntervalAction } from "@/app/assets/calibration/actions";

/** Calibration of one clinical device (wave 37): state, history, the interval and its override. Server component. */
export async function CalibrationPanel({ assetId, deviceTypeId, required, canRecord, canEdit, disposed }: {
  assetId: number; deviceTypeId: number; required: boolean; canRecord: boolean; canEdit: boolean; disposed: boolean;
}) {
  const [rows, iv] = await Promise.all([
    db.select().from(calibrations).where(eq(calibrations.assetId, assetId)).orderBy(desc(calibrations.calibratedOn), desc(calibrations.id)).limit(8),
    intervalFor(assetId, deviceTypeId),
  ]);
  if (!required && rows.length === 0) return null;
  const state = calibrationState(rows[0], todayISO());
  return (
    <Panel title={<span id="calibration">Calibration</span>} padded={false}
      actions={canRecord && !disposed ? <LinkButton href={`/assets/calibration/new?assetId=${assetId}`} variant="ghost">Record a calibration</LinkButton> : undefined}>
      <p className="px-5 pt-3 text-sm text-muted">
        <Badge tone={CALIBRATION_STATE_TONE[state]}>{CALIBRATION_STATE_LABELS[state]}</Badge>{" "}
        Every {iv.months} months{iv.source === "device" ? ` (this device${iv.reason ? `: ${iv.reason}` : ""})` : iv.source === "type" ? " (device type)" : " (default)"}.
        {state === "failed" && <b className="text-danger"> The last calibration failed: the device stays out of service until one passes.</b>}
      </p>
      {rows.length === 0 ? <p className="px-5 py-3 text-sm text-muted">No calibration on record.</p> : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
              <Badge tone={CALIBRATION_RESULT_TONE[c.result]}>{CALIBRATION_RESULT_LABELS[c.result]}</Badge>
              <Link href={`/assets/calibration/${c.id}`} className="font-semibold text-primary hover:underline">{formatDate(c.calibratedOn)}</Link>
              <span className="text-muted">by {c.performedBy}{c.certificateRef ? ` · certificate ${c.certificateRef}` : ""}</span>
              {c.nextDue && <span className="ml-auto text-muted">next due {formatDate(c.nextDue)}</span>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !disposed && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer text-primary">Change this device&apos;s interval</summary>
          <ActionForm action={setAssetCalibrationIntervalAction} className="mt-3 space-y-3">
            <input type="hidden" name="assetId" value={assetId} />
            <FormGrid cols={2}>
              <Field label="Every (months)" hint={`Leave blank for the device type's: ${iv.typeMonths ?? 12} months.`}><Input type="number" name="intervalMonths" min={1} max={120} defaultValue={iv.own ?? ""} /></Field>
              <Field label="Why"><Input name="reason" maxLength={300} defaultValue={iv.reason ?? ""} placeholder="e.g. the maker asks for six-monthly" /></Field>
            </FormGrid>
            <SubmitButton variant="secondary">Save interval</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

/** A device type's calibration interval (wave 37), on its catalogue page. Server component. */
export async function TypeCalibrationPanel({ deviceTypeId, code, required, canEdit }: { deviceTypeId: number; code: string; required: boolean; canEdit: boolean }) {
  if (!required) return null;
  const [row] = await db.select({ m: deviceTypeCalibration.intervalMonths }).from(deviceTypeCalibration).where(eq(deviceTypeCalibration.deviceTypeId, deviceTypeId));
  return (
    <Panel title="Calibration interval">
      <p className="mb-3 text-sm text-muted">Devices of this type are calibrated every {row?.m ?? DEFAULT_CALIBRATION_MONTHS} months{row ? "" : " (default)"}. A device can have its own interval on its page. <Link href="/assets/calibration" className="text-primary hover:underline">Calibration schedule</Link></p>
      {canEdit && <ActionForm action={setTypeCalibrationIntervalAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="code" value={code} />
        <Field label="Every (months)" hint="Blank for 12 months."><Input type="number" name="intervalMonths" min={1} max={120} defaultValue={row?.m ?? ""} className="w-32" /></Field>
        <SubmitButton variant="secondary">Save interval</SubmitButton>
      </ActionForm>}
    </Panel>
  );
}

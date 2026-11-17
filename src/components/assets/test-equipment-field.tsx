import { calibrationState, instrumentLabel, type Instrument } from "@/lib/assets/test-equipment";
import { formatDate, todayISO } from "@/lib/format";

/**
 * "Test equipment used" checkboxes for completing a maintenance visit (wave 27). Optional. The server refuses an
 * instrument whose calibration has run out; its message appears under the list (the `<output name="testEquipment">`).
 */
export function TestEquipmentField({ options }: { options: Instrument[] }) {
  const today = todayISO();
  return (
    <fieldset className="rounded-[var(--radius-control)] border border-line px-3 py-2">
      <legend className="px-1 text-sm font-semibold">Test equipment used <span className="font-normal text-muted">(optional)</span></legend>
      {options.length === 0 ? <p className="text-xs text-muted">No test equipment is registered for this hospital. Mark a tester or analyser as test equipment on its asset page.</p> : (
        <ul className="space-y-1">
          {options.map((o) => {
            const st = calibrationState(o.calibrationDue, today);
            return (
              <li key={o.id}>
                <label className="flex min-h-6 items-start gap-2 text-sm">
                  <input type="checkbox" name="testEquipmentIds" value={o.id} className="mt-0.5 size-5 shrink-0" />
                  <span>{instrumentLabel(o)}
                    <span className={`block text-xs ${st === "ok" ? "text-muted" : "font-semibold text-danger"}`}>
                      {st === "ok" ? `Calibrated to ${formatDate(o.calibrationDue)}` : st === "expired" ? `Calibration ran out ${formatDate(o.calibrationDue)}` : "No calibration date"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <output name="testEquipment" className="block" />
    </fieldset>
  );
}

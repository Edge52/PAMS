import { Field, Input } from "@/components/ui";
import { meterOf } from "@/lib/assets/meters-server";
import { formatDate, formatNumber } from "@/lib/format";

/**
 * "Meter reading now" on a maintenance sign-off form (wave 29). Shown only for a device with a usage meter. Optional,
 * but it makes the next usage-based due date exact instead of estimated.
 */
export async function MeterAtVisit({ assetId }: { assetId: number }) {
  const m = await meterOf(assetId);
  if (!m) return null;
  return (
    <Field label={`Meter reading now (${m.unit})`} hint={m.last ? `Last: ${formatNumber(m.last.reading)} on ${formatDate(m.last.readOn)}. Optional; it makes the next due date exact.` : "Optional; it makes the next due date exact."}>
      <Input type="number" name="meterReading" min={m.last?.reading ?? 0} step="any" inputMode="decimal" className="max-w-48" />
    </Field>
  );
}

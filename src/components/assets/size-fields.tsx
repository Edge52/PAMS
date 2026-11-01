import { Field, FormGrid, Input } from "@/components/ui";
import { DIM_MAX, DIM_MIN } from "@/lib/assets/dimensions";

/**
 * Real size of a device (wave 7), metres: shown in the 3D view, renders and placement at this size. All three, or
 * none to use the make and model's datasheet size, the device type's, or the typical size for its group.
 */
export function SizeFields({ lengthM, widthM, heightM, typical }: { lengthM?: number | null; widthM?: number | null; heightM?: number | null; typical?: string | null }) {
  const props = { type: "number", min: DIM_MIN, max: DIM_MAX, step: 0.01, inputMode: "decimal" as const };
  return (
    <div className="mt-4">
      <FormGrid cols={3}>
        <Field label="Length (m)" hint="The long side of the footprint"><Input name="lengthM" {...props} defaultValue={lengthM ?? ""} /></Field>
        <Field label="Width (m)"><Input name="widthM" {...props} defaultValue={widthM ?? ""} /></Field>
        <Field label="Height (m)"><Input name="heightM" {...props} defaultValue={heightM ?? ""} /></Field>
      </FormGrid>
      <p className="mt-1.5 text-xs text-muted">
        From the datasheet. Leave all three empty to use the make and model&apos;s size, the device type&apos;s, or the typical size for its group
        {typical ? <> (now {typical})</> : null}. The 3D view and renders show the device at this size.
      </p>
    </div>
  );
}

import { Field, FormGrid, Input, Textarea } from "@/components/ui";
import { DeviceTypeSelect } from "@/components/assets/bits";
import type { DeviceTypeOption } from "@/lib/assets/queries";

/** Fields of a make and model (the catalogue form for new and existing models). */
export function ModelFields({ types, v = {} }: {
  types: DeviceTypeOption[];
  v?: { deviceTypeId?: number | null; manufacturer?: string; model?: string; refPriceUsd?: string | null; endOfSale?: string | null; endOfSupport?: string | null; notes?: string | null };
}) {
  return (
    <>
      <Field label="Device type"><DeviceTypeSelect types={types} value={v.deviceTypeId} required /></Field>
      <FormGrid>
        <Field label="Manufacturer"><Input name="manufacturer" required maxLength={120} defaultValue={v.manufacturer} placeholder="Philips" /></Field>
        <Field label="Model"><Input name="model" required maxLength={120} defaultValue={v.model} placeholder="IntelliVue MX450" /></Field>
        <Field label="Reference price (USD)" hint="Optional: list or last purchase price."><Input name="refPriceUsd" type="number" min={0} step="0.01" defaultValue={v.refPriceUsd ?? ""} /></Field>
        <div />
        <Field label="End of sale" hint="The maker stops selling it."><Input name="endOfSale" type="date" defaultValue={v.endOfSale ?? ""} /></Field>
        <Field label="End of support" hint="No more parts or service from the maker."><Input name="endOfSupport" type="date" defaultValue={v.endOfSupport ?? ""} /></Field>
      </FormGrid>
      <Field label="Notes"><Textarea name="notes" rows={3} maxLength={2000} defaultValue={v.notes ?? ""} /></Field>
    </>
  );
}

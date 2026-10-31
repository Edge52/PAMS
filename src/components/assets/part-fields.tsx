/** Fields shared by the new-part and edit-part forms. */
import { Field, FormGrid, Input } from "@/components/ui";
import { DeviceTypeSelect, NativeSelect } from "@/components/assets/bits";
import type { DeviceTypeOption } from "@/lib/assets/queries";
import { CURRENCIES } from "@/lib/format";

export type PartValues = {
  partNumber?: string; name?: string; manufacturer?: string | null; deviceTypeId?: number | null; supplierId?: number | null;
  unitCost?: string | null; currency?: string | null; minQty?: number; location?: string | null;
};

export function PartFields({ types, suppliers, v = {} }: { types: DeviceTypeOption[]; suppliers: { id: number; name: string }[]; v?: PartValues }) {
  return (
    <FormGrid cols={2}>
      <Field label="Part number" hint="The manufacturer's or supplier's number."><Input name="partNumber" required maxLength={64} defaultValue={v.partNumber} autoCapitalize="characters" /></Field>
      <Field label="Name"><Input name="name" required maxLength={200} defaultValue={v.name} placeholder="e.g. SpO2 sensor, adult, reusable" /></Field>
      <Field label="Manufacturer"><Input name="manufacturer" maxLength={120} defaultValue={v.manufacturer ?? ""} /></Field>
      <Field label="Fits device type" hint="Leave blank for general-purpose parts."><DeviceTypeSelect types={types} value={v.deviceTypeId} placeholder="Any device" /></Field>
      <Field label="Usual supplier"><NativeSelect name="supplierId" value={v.supplierId} placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} /></Field>
      <Field label="Store location"><Input name="location" maxLength={120} defaultValue={v.location ?? ""} placeholder="e.g. BME store, shelf B3" /></Field>
      <Field label="Unit cost"><Input type="number" name="unitCost" min={0} step="0.01" defaultValue={v.unitCost ?? ""} /></Field>
      <Field label="Currency"><NativeSelect name="currency" value={v.currency ?? "EGP"} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
      <Field label="Minimum stock" hint="You are told when stock falls to this level."><Input type="number" name="minQty" min={0} defaultValue={v.minQty ?? 0} /></Field>
    </FormGrid>
  );
}

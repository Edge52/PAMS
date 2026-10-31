/** Fields shared by the new-contract and edit-contract forms. */
import { Field, FormGrid, Input, Textarea } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { CONTRACT_TYPE_LABELS, CONTRACT_TYPES } from "@/lib/assets/contracts";
import { CURRENCIES } from "@/lib/format";

export type ContractValues = {
  supplierId?: number; title?: string; type?: string; vendorReference?: string | null; startDate?: string; endDate?: string;
  value?: string | null; currency?: string | null; responseHours?: number | null; ppmVisitsPerYear?: number | null; includesParts?: boolean;
  contactName?: string | null; contactPhone?: string | null; notes?: string | null;
};

export function ContractFields({ suppliers, v = {} }: { suppliers: { id: number; name: string }[]; v?: ContractValues }) {
  return (
    <div className="space-y-4">
      <FormGrid cols={2}>
        <Field label="Title"><Input name="title" required maxLength={200} defaultValue={v.title} placeholder="e.g. ICU ventilators full service 2026–2028" /></Field>
        <Field label="Supplier"><NativeSelect name="supplierId" required value={v.supplierId} placeholder="Choose a supplier…" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="Type"><NativeSelect name="type" value={v.type ?? "FULL_SERVICE"} options={CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_LABELS[t] }))} /></Field>
        <Field label="Supplier's reference"><Input name="vendorReference" maxLength={120} defaultValue={v.vendorReference ?? ""} /></Field>
      </FormGrid>
      <FormGrid cols={4}>
        <Field label="Starts"><Input type="date" name="startDate" required defaultValue={v.startDate} /></Field>
        <Field label="Ends"><Input type="date" name="endDate" required defaultValue={v.endDate} /></Field>
        <Field label="Value"><Input type="number" name="value" min={0} step="0.01" defaultValue={v.value ?? ""} /></Field>
        <Field label="Currency"><NativeSelect name="currency" value={v.currency ?? "EGP"} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Response time (hours)" hint="Promised on-site response."><Input type="number" name="responseHours" min={1} defaultValue={v.responseHours ?? ""} /></Field>
        <Field label="PPM visits a year"><Input type="number" name="ppmVisitsPerYear" min={0} max={52} defaultValue={v.ppmVisitsPerYear ?? ""} /></Field>
        <Field label="Supplier contact"><Input name="contactName" maxLength={120} defaultValue={v.contactName ?? ""} /></Field>
        <Field label="Contact phone"><Input name="contactPhone" maxLength={48} inputMode="tel" defaultValue={v.contactPhone ?? ""} /></Field>
      </FormGrid>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includesParts" defaultChecked={v.includesParts} /> Spare parts are included</label>
      <Field label="Notes" hint="Exclusions, penalties, uptime guarantee…"><Textarea name="notes" rows={3} defaultValue={v.notes ?? ""} /></Field>
    </div>
  );
}

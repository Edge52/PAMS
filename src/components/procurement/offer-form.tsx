import { Field, FormGrid, Input, Panel, Select, Textarea } from "@/components/ui";
import { CURRENCIES } from "@/lib/format";
import type { ActionState } from "@/lib/procurement/forms";
import { incotermOptions } from "@/lib/procurement/labels";
import type { EditableOfferLine } from "@/lib/procurement/offer-lines";
import { ActionForm, SubmitButton } from "./action-form";
import { OfferLinesEditor, type BoqLineOption, type DeviceTypeOption } from "./offer-lines-editor";

export type OfferHeader = {
  supplierId?: number | null; reference?: string; offerDate?: string; validUntil?: string | null; currency?: string;
  incoterm?: string | null; deliveryWeeks?: number | null; warrantyMonths?: number | null; paymentTerms?: string | null; notes?: string | null;
  tcoServiceAnnual?: string | null; tcoConsumablesAnnual?: string | null; tcoEnergyAnnual?: string | null; tcoOtherAnnual?: string | null; tcoUptimePct?: number | null;
};

export function OfferForm({ action, projectId, rfqId, header, lines, suppliers, deviceTypes, boqLines, submitLabel }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  projectId: number; rfqId: number | null; header: OfferHeader; lines: EditableOfferLine[];
  suppliers: { id: number; name: string }[]; deviceTypes: DeviceTypeOption[]; boqLines: BoqLineOption[]; submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="rfqId" value={rfqId ?? ""} />
      <Panel title="Quotation">
        <FormGrid cols={4}>
          <Field label="Supplier" className="sm:col-span-2">
            <Select name="supplierId" required defaultValue={header.supplierId ?? ""} placeholder="Choose the supplier"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="Supplier's reference" hint="Their quotation number">
            <Input name="reference" required maxLength={64} defaultValue={header.reference ?? ""} />
          </Field>
          <Field label="Offer date"><Input type="date" name="offerDate" required defaultValue={header.offerDate ?? ""} /></Field>
          <Field label="Valid until"><Input type="date" name="validUntil" defaultValue={header.validUntil ?? ""} /></Field>
          <Field label="Currency">
            <Select name="currency" defaultValue={header.currency ?? "USD"} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Incoterm">
            <Select name="incoterm" defaultValue={header.incoterm ?? ""} placeholder="Not stated" options={incotermOptions} />
          </Field>
          <Field label="Delivery (weeks)"><Input type="number" min={0} step={1} name="deliveryWeeks" defaultValue={header.deliveryWeeks ?? ""} /></Field>
          <Field label="Warranty (months)"><Input type="number" min={0} step={1} name="warrantyMonths" defaultValue={header.warrantyMonths ?? ""} /></Field>
          <Field label="Payment terms" className="sm:col-span-2 lg:col-span-3">
            <Input name="paymentTerms" defaultValue={header.paymentTerms ?? ""} placeholder="e.g. 30% advance against bank guarantee, 70% on installation" />
          </Field>
        </FormGrid>
        <Field label="Notes" className="mt-4"><Textarea name="notes" rows={2} defaultValue={header.notes ?? ""} /></Field>
      </Panel>
      <Panel title="Running costs (for total cost of ownership)">
        <p className="mb-3 text-sm text-muted">From the offer&apos;s commercial terms, in the offer currency, for the whole offer. Leave blank what the offer doesn&apos;t state.</p>
        <FormGrid cols={4}>
          <Field label="Service contract a year" hint="After the warranty"><Input type="number" min={0} step="0.01" name="tcoServiceAnnual" defaultValue={header.tcoServiceAnnual ?? ""} /></Field>
          <Field label="Consumables a year"><Input type="number" min={0} step="0.01" name="tcoConsumablesAnnual" defaultValue={header.tcoConsumablesAnnual ?? ""} /></Field>
          <Field label="Energy a year"><Input type="number" min={0} step="0.01" name="tcoEnergyAnnual" defaultValue={header.tcoEnergyAnnual ?? ""} /></Field>
          <Field label="Other a year" hint="Helium, licences…"><Input type="number" min={0} step="0.01" name="tcoOtherAnnual" defaultValue={header.tcoOtherAnnual ?? ""} /></Field>
          <Field label="Uptime guarantee (%)"><Input type="number" min={50} max={100} step="0.1" name="tcoUptimePct" defaultValue={header.tcoUptimePct ?? ""} /></Field>
        </FormGrid>
      </Panel>
      <Panel title="Lines">
        <OfferLinesEditor initial={lines} deviceTypes={deviceTypes} boqLines={boqLines} defaultCurrency={header.currency ?? "USD"} />
      </Panel>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

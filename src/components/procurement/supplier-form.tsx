import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import type { suppliers } from "@/db/schema";
import type { ActionState } from "@/lib/procurement/forms";
import { options, SUPPLIER_TYPES } from "@/lib/procurement/labels";
import { LEGAL_NAME_LABEL } from "@/lib/procurement/legal-names";
import { ActionForm, SubmitButton } from "./action-form";

type Supplier = typeof suppliers.$inferSelect;

export function SupplierForm({ action, supplier, submitLabel, nameAr }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; supplier?: Supplier; submitLabel: string;
  /** Wave 38: the Arabic legal name, shown only on letters and the purchase order print. */
  nameAr?: string | null;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <FormGrid cols={3}>
        <Field label="Company name" className="sm:col-span-2"><Input name="name" required defaultValue={supplier?.name} /></Field>
        <Field label="Type"><Select name="type" defaultValue={supplier?.type ?? "DISTRIBUTOR"} options={options(SUPPLIER_TYPES)} /></Field>
        <Field label={LEGAL_NAME_LABEL} hint="As on the commercial register. Shown only on award, regret and extension letters and the purchase order." className="sm:col-span-3">
          <Input name="nameAr" lang="ar" dir="rtl" className="font-arabic" defaultValue={nameAr ?? ""} maxLength={300} />
        </Field>
        <Field label="Brands represented" hint="Separate with commas" className="sm:col-span-2">
          <Input name="brands" defaultValue={supplier?.brands?.join(", ") ?? ""} placeholder="Mindray, Dräger" />
        </Field>
        <Field label="Country"><Input name="country" defaultValue={supplier?.country ?? "Egypt"} /></Field>
        <Field label="Contact person"><Input name="contactName" defaultValue={supplier?.contactName ?? ""} /></Field>
        <Field label="Email"><Input type="email" name="email" defaultValue={supplier?.email ?? ""} /></Field>
        <Field label="Phone"><Input type="tel" name="phone" defaultValue={supplier?.phone ?? ""} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={supplier?.address ?? ""} /></Field>
        <Field label="Rating (0–5)" hint="Delivery, after-sales and compliance track record">
          <Input type="number" name="rating" min={0} max={5} step="0.5" defaultValue={supplier?.rating ?? ""} />
        </Field>
        <Field label="Tax ID"><Input name="taxId" defaultValue={supplier?.taxId ?? ""} /></Field>
        <Field label="Commercial register"><Input name="commercialRegister" defaultValue={supplier?.commercialRegister ?? ""} /></Field>
      </FormGrid>
      <Field label="Notes" hint="Other contacts (service manager, tender desk), agency letters, remarks">
        <Textarea name="notes" rows={4} defaultValue={supplier?.notes ?? ""} />
      </Field>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

/** Wave 38: edit a device type's Arabic name (used on letters and specification sheets only). */
import { Field, Input, Panel } from "@/components/ui";
import { saveDeviceTypeLegalNameAction } from "@/app/catalogue/legal-name-actions";
import { LEGAL_NAME_LABEL } from "@/lib/procurement/legal-names";
import { ActionForm, SubmitButton } from "./action-form";

export function DeviceTypeLegalNameForm({ code, nameAr }: { code: string; nameAr: string | null }) {
  return (
    <Panel title="Name on letters">
      <ActionForm action={saveDeviceTypeLegalNameAction} className="space-y-3">
        <input type="hidden" name="code" value={code} />
        <Field label={LEGAL_NAME_LABEL} hint="Printed under the English name on award letters and specification sheets. Leave blank for none.">
          <Input name="nameAr" lang="ar" dir="rtl" className="font-arabic" defaultValue={nameAr ?? ""} maxLength={300} />
        </Field>
        <SubmitButton variant="secondary">Save Arabic name</SubmitButton>
      </ActionForm>
    </Panel>
  );
}

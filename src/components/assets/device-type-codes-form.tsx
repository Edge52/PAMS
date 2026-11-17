/** Edit a device type's codes and classification (wave 27). Shown to people with `catalogue.edit`. */
import { Field, FormGrid, Input, Panel, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { saveDeviceTypeCodesAction } from "@/app/catalogue/actions";
import { humanize } from "@/lib/status";

type Dt = { code: string; gmdnCode: string | null; gmdnTerm: string | null; umdnsCode: string | null; riskClass: string | null; criticality: string | null; lifeExpectancyYears: number | null; requiresCalibration: boolean };

export function DeviceTypeCodesForm({ dt }: { dt: Dt }) {
  return (
    <Panel title="Edit codes and classification">
      <ActionForm action={saveDeviceTypeCodesAction} className="space-y-4">
        <input type="hidden" name="code" value={dt.code} />
        <FormGrid cols={2}>
          <Field label="GMDN code" hint="5 digits, from the GMDN Agency or the maker's label. Leave empty if not known.">
            <Input name="gmdnCode" defaultValue={dt.gmdnCode ?? ""} inputMode="numeric" maxLength={20} autoComplete="off" />
          </Field>
          <Field label="GMDN term"><Input name="gmdnTerm" defaultValue={dt.gmdnTerm ?? ""} maxLength={300} /></Field>
          <Field label="UMDNS code"><Input name="umdnsCode" defaultValue={dt.umdnsCode ?? ""} maxLength={16} /></Field>
          <Field label="Risk class">
            <Select name="riskClass" defaultValue={dt.riskClass ?? ""} placeholder="Not set" options={["I", "IIa", "IIb", "III"].map((v) => ({ value: v, label: `Class ${v}` }))} />
          </Field>
          <Field label="Criticality">
            <Select name="criticality" defaultValue={dt.criticality ?? ""} placeholder="Not set" options={["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"].map((v) => ({ value: v, label: humanize(v) }))} />
          </Field>
          <Field label="Life expectancy (years)"><Input name="lifeExpectancyYears" type="number" min={1} max={50} step={1} defaultValue={dt.lifeExpectancyYears ?? ""} /></Field>
        </FormGrid>
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input type="checkbox" name="requiresCalibration" defaultChecked={dt.requiresCalibration} className="size-5" /> Needs calibration
        </label>
        <SubmitButton variant="secondary">Save codes</SubmitButton>
      </ActionForm>
    </Panel>
  );
}

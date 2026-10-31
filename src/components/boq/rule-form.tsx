import { Button, Field, FormGrid, Input, Select } from "@/components/ui";
import { BASES, BASIS_LABELS, ROUNDINGS, ROUNDING_LABELS } from "@/lib/boq/engine";
import type { RuleRow } from "@/lib/boq/queries";
import { saveRule } from "@/app/boq/standards/actions";
import { DevicePicker, type DeviceOption } from "./device-picker";

type Opt = { value: string | number; label: string };

const BASIS_HINT: Record<string, string> = {
  PER_BED: "ratio × department beds",
  PER_ROOM: "ratio × department rooms (theatres, imaging rooms, clinics)",
  PER_DEPARTMENT: "ratio × 1, for each department of this type",
  PER_HOSPITAL_BEDS: "ratio × total hospital beds — enter 1/100 for one per 100 beds",
  FIXED: "the ratio is the quantity",
};

/** Add / edit a rule. Server-rendered form; only the device picker is a client component. */
export function RuleForm({ setId, rule, deptTypes, devices, sources, defaultDept, filter, cancelHref }: {
  setId: number; rule?: RuleRow; deptTypes: Opt[]; devices: DeviceOption[]; sources: { id: string; title: string }[];
  defaultDept?: string; filter?: string; cancelHref: string;
}) {
  return (
    <form action={saveRule} className="space-y-4" id="rule-form">
      <input type="hidden" name="setId" value={setId} />
      {rule && <input type="hidden" name="ruleId" value={rule.id} />}
      {filter && <input type="hidden" name="dept" value={filter} />}
      <FormGrid cols={4}>
        <Field label="Department type">
          <Select name="departmentTypeCode" defaultValue={rule?.departmentTypeCode ?? defaultDept} options={deptTypes} required />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <span className="mb-1 block text-sm font-semibold">Device type</span>
          <DevicePicker options={devices} defaultId={rule?.deviceTypeId} required />
        </div>
        <Field label="Basis" hint={Object.entries(BASIS_HINT).map(([k, v]) => `${BASIS_LABELS[k as keyof typeof BASIS_LABELS]}: ${v}`).join(". ")} className="sm:col-span-2">
          <Select name="basis" defaultValue={rule?.basis ?? "PER_BED"} options={BASES.map((b) => ({ value: b, label: `${BASIS_LABELS[b]} — ${BASIS_HINT[b]}` }))} />
        </Field>
        <Field label="Ratio" hint="A number (1, 0.5, 2) or a fraction: 1/4 = one per 4 beds, 1/100 = one per 100 beds.">
          <Input name="ratio" defaultValue={rule ? String(rule.ratio) : "1"} required inputMode="decimal" />
        </Field>
        <Field label="Rounding">
          <Select name="rounding" defaultValue={rule?.rounding ?? "CEIL"} options={ROUNDINGS.map((r) => ({ value: r, label: ROUNDING_LABELS[r] }))} />
        </Field>
        <Field label="Minimum" hint="Per department instance. 0 = none.">
          <Input name="minQty" type="number" min={0} defaultValue={rule?.minQty ?? 0} />
        </Field>
        <Field label="Maximum" hint="Leave empty for no cap.">
          <Input name="maxQty" type="number" min={0} defaultValue={rule?.maxQty ?? ""} />
        </Field>
        <Field label="Tier">
          <Select name="tier" defaultValue={rule?.tier ?? "ESSENTIAL"}
            options={[{ value: "ESSENTIAL", label: "Essential" }, { value: "RECOMMENDED", label: "Recommended" }, { value: "OPTIONAL", label: "Optional" }]} />
        </Field>
        <Field label="Confidence">
          <Select name="confidence" defaultValue={rule?.confidence ?? "DRAFT"}
            options={[{ value: "SOURCED", label: "Sourced (cited guideline)" }, { value: "INDUSTRY_PRACTICE", label: "Industry practice" }, { value: "DRAFT", label: "Draft / own estimate" }]} />
        </Field>
        <Field label="Source">
          <Select name="sourceRef" defaultValue={rule?.sourceRef ?? ""} placeholder="No source"
            options={sources.map((s) => ({ value: s.id, label: `${s.id} — ${s.title}`.slice(0, 80) }))} />
        </Field>
        <Field label="Notes" className="sm:col-span-2 lg:col-span-3">
          <Input name="notes" defaultValue={rule?.notes ?? ""} placeholder="Why this ratio — e.g. one per bed plus 10% spare" />
        </Field>
      </FormGrid>
      <div className="flex flex-wrap gap-2">
        <Button>{rule ? "Save rule" : "Add rule"}</Button>
        <a href={cancelHref} className="inline-flex items-center rounded-[var(--radius-control)] px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft">Cancel</a>
      </div>
    </form>
  );
}

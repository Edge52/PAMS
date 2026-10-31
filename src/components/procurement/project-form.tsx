import { FormGrid, Field, Input, Select, Textarea } from "@/components/ui";
import { CURRENCIES } from "@/lib/format";
import { CLIENT_SUGGESTIONS, options, PROJECT_STATUSES } from "@/lib/procurement/labels";
import type { projects } from "@/db/schema";
import { ActionForm, SubmitButton } from "./action-form";
import type { ActionState } from "@/lib/procurement/forms";

type Project = typeof projects.$inferSelect;

export function ProjectForm({ action, project, facilities, submitLabel }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  project?: Project;
  facilities: { id: number; code: string; name: string }[];
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <FormGrid cols={3}>
        <Field label="Tender or project code" hint="E.g. the UPA tender number">
          <Input name="code" required maxLength={48} defaultValue={project?.code} placeholder="UPA-2026-ICU-014" />
        </Field>
        <Field label="Title" className="sm:col-span-2">
          <Input name="title" required defaultValue={project?.title} placeholder="ICU & CCU equipment upgrade" />
        </Field>
        <Field label="Client" hint="UPA, UHI, Ministry of Health, private…">
          <Input name="client" list="client-suggestions" defaultValue={project?.client ?? ""} />
          <datalist id="client-suggestions">{CLIENT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Facility" hint="Where the equipment will be delivered and installed">
          <Select name="facilityId" defaultValue={project?.facilityId ?? (facilities.length === 1 ? facilities[0].id : "")}
            placeholder="No facility yet" options={facilities.map((f) => ({ value: f.id, label: `${f.name} (${f.code})` }))} />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={project?.status ?? "PLANNING"} options={options(PROJECT_STATUSES)} />
        </Field>
        <Field label="Evaluation currency" hint="Offers are converted to this currency for comparison">
          <Select name="currency" defaultValue={project?.currency ?? "USD"} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Budget">
          <Input name="budget" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={project?.budget ?? ""} />
        </Field>
        <Field label="Submission deadline">
          <Input name="submissionDeadline" type="date" defaultValue={project?.submissionDeadline ?? ""} />
        </Field>
      </FormGrid>
      <Field label="Notes" hint="Scope, funding source, special conditions">
        <Textarea name="notes" rows={4} defaultValue={project?.notes ?? ""} />
      </Field>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

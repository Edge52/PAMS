import { Field, FormGrid, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ROLES, ROLE_LABELS } from "@/lib/auth/permissions";
import type { ActionState } from "@/lib/procurement/forms";

type U = { id: number; name: string; email: string; role: string; jobTitle: string | null; phone: string | null; allFacilities: boolean; active: boolean };

export function UserForm({ action, user, facilities, selected, submitLabel }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>; user?: U;
  facilities: { id: number; name: string }[]; selected: number[]; submitLabel: string;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      {user && <input type="hidden" name="id" value={user.id} />}
      <FormGrid cols={2}>
        <Field label="Name"><Input name="name" required defaultValue={user?.name} /></Field>
        <Field label="Email" hint="They sign in with this"><Input type="email" name="email" required defaultValue={user?.email} /></Field>
        <Field label="Role" hint="Decides what they can change; everyone can read">
          <Select name="role" defaultValue={user?.role ?? "VIEWER"} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </Field>
        <Field label="Job title"><Input name="jobTitle" defaultValue={user?.jobTitle ?? ""} placeholder="Head of biomedical engineering" /></Field>
        <Field label="Phone"><Input type="tel" name="phone" defaultValue={user?.phone ?? ""} /></Field>
        {!user && <Field label="Temporary password" hint="At least 8 characters; they can change it after signing in"><Input type="text" name="password" required autoComplete="off" /></Field>}
      </FormGrid>
      <fieldset className="rounded-[var(--radius-control)] border border-line p-3">
        <legend className="px-1 text-sm font-semibold">Facilities</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allFacilities" defaultChecked={user?.allFacilities ?? true} /> All facilities (administrators always see all)</label>
        {facilities.length > 0 && (
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {facilities.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="facilityIds" value={f.id} defaultChecked={selected.includes(f.id)} /> {f.name}
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Untick “All facilities” to limit them to the ticked ones.</p>
      </fieldset>
      {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={user.active} /> Account is switched on</label>}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}

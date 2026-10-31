import { Button, Field, FormGrid, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { DeviceTypeSelect, NativeSelect } from "@/components/assets/bits";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { RECALL_ACTION_LABELS, RECALL_ACTIONS } from "@/lib/assets/recalls";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { todayISO } from "@/lib/format";
import { createRecallAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record a safety notice" };

export default async function NewRecallPage() {
  const me = await requirePermission("assets.view");
  const types = await deviceTypeOptions();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Record a safety notice" back={{ href: "/assets/recalls", label: "Recalls" }}
        description="Copy the details from the manufacturer's field safety notice. Every device in the register that matches all the criteria you give is listed." />
      {!can(me.role, "recalls.edit") ? <p className="text-sm text-muted">Your account can&apos;t record recalls. Ask the biomedical team.</p> : (
        <Panel>
          <ActionForm action={createRecallAction} className="space-y-5">
            <FormGrid cols={2}>
              <Field label="Title"><Input name="title" required maxLength={200} placeholder="e.g. Risk of battery failure on Evita V500" /></Field>
              <Field label="Manufacturer's reference"><Input name="reference" maxLength={120} placeholder="FSN number" /></Field>
              <Field label="Source"><Input name="source" maxLength={80} placeholder="Manufacturer, EDA, FDA…" /></Field>
              <Field label="Required action"><NativeSelect name="action" value="INSPECT" options={RECALL_ACTIONS.map((a) => ({ value: a, label: RECALL_ACTION_LABELS[a] }))} /></Field>
              <Field label="Issued on"><Input type="date" name="issuedDate" defaultValue={todayISO()} /></Field>
              <Field label="Complete by"><Input type="date" name="dueDate" /></Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="urgent" /> Urgent: patient risk, act immediately</label>
            <Field label="What the notice says"><Textarea name="description" rows={4} /></Field>
            <fieldset className="rounded-[var(--radius-control)] border border-line p-4">
              <legend className="px-1 text-sm font-semibold">Which devices</legend>
              <FormGrid cols={2}>
                <Field label="Device type"><DeviceTypeSelect types={types} placeholder="Any type" /></Field>
                <Field label="Manufacturer" hint="As recorded on the devices; case and dashes don't matter."><Input name="manufacturer" maxLength={120} /></Field>
                <Field label="Model contains"><Input name="modelPattern" maxLength={120} placeholder="e.g. V500" /></Field>
                <Field label="Affected serial numbers" hint="One per line or comma separated. Leave blank if every serial is affected."><Textarea name="serials" rows={3} className="font-mono text-[13px]" /></Field>
              </FormGrid>
            </fieldset>
            <Button>Record notice and find devices</Button>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

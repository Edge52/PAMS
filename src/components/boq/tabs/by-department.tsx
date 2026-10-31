import Link from "next/link";
import { Button, EmptyState, Field, FormGrid, Input, Panel, Select } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import type { BoqWorkspace } from "@/lib/boq/queries";
import { addManualLine, deleteLine, updateLine } from "@/app/boq/actions";
import { LineRow } from "../line-row";
import { DevicePicker, type DeviceOption } from "../device-picker";

export function ByDepartmentTab({ ws, locked, showWhy, devices }: {
  ws: BoqWorkspace; locked: boolean; showWhy: boolean; devices: DeviceOption[];
}) {
  const { boq, depts, lines, totals } = ws;
  const base = `/boq/${boq.id}?tab=department`;
  if (depts.length === 0) {
    return (
      <EmptyState title="No departments in scope"
        action={<Link href={`/boq/${boq.id}?tab=scope`} className="font-semibold text-primary hover:underline">Add departments</Link>}>
        Add the departments to equip, then regenerate from the standard.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted">
          Hover a quantity to see how it was calculated, or{" "}
          {showWhy
            ? <Link href={base} className="font-semibold text-primary hover:underline">hide the calculations</Link>
            : <Link href={`${base}&why=1`} className="font-semibold text-primary hover:underline">show every calculation</Link>}.
        </p>
        {!locked && <a href="#add-line" className="font-semibold text-primary hover:underline">Add a line by hand ↓</a>}
      </div>

      {depts.map((d) => {
        const dl = lines.filter((l) => l.boqDepartmentId === d.id);
        const sub = totals.byDepartment.get(d.id) ?? 0;
        return (
          <section key={d.id} id={`dept-${d.id}`} className="scroll-mt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[16px] font-semibold">
                {d.label}
                <span className="ml-2 text-sm font-normal text-muted">
                  {d.typeName}
                  {d.beds > 0 && ` · ${d.beds} beds`}
                  {d.rooms > 0 && ` · ${d.rooms} rooms`}
                  {d.instances > 1 && ` · ×${d.instances}`}
                </span>
              </h3>
              <span className="text-sm"><span className="text-muted">Subtotal </span><span className="font-semibold">{formatMoney(sub, boq.currency)}</span></span>
            </div>
            {dl.length === 0 ? (
              <p className="rounded-[var(--radius-panel)] border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">
                The standard has no rules for this department type at the selected tiers. Add lines by hand, or add rules in the{" "}
                <Link href={`/boq/standards/${boq.standardSetId}?dept=${d.departmentTypeCode}`} className="text-primary hover:underline">standard set</Link>.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
                <table className="w-full min-w-[760px] border-collapse text-[14px]">
                  <thead className="bg-sunken text-left text-[13px] text-muted">
                    <tr>
                      <th className="border-b border-line px-3 py-2 font-semibold">Device</th>
                      <th className="border-b border-line px-3 py-2 font-semibold">Tier</th>
                      <th className="border-b border-line px-3 py-2 text-right font-semibold">Qty</th>
                      <th className="border-b border-line px-3 py-2 text-right font-semibold" title="Quantity the standard produces">Standard</th>
                      <th className="border-b border-line px-3 py-2 text-right font-semibold">Unit estimate</th>
                      <th className="border-b border-line px-3 py-2 text-right font-semibold">Total</th>
                      <th className="border-b border-line px-3 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dl.map((l) => (
                      <LineRow key={l.id} line={l} currency={boq.currency} locked={locked} showWhy={showWhy} tab="department"
                        updateAction={updateLine} deleteAction={deleteLine} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {!locked && (
        <Panel title="Add a line by hand" className="scroll-mt-4" >
          <form action={addManualLine} id="add-line">
            <input type="hidden" name="boqId" value={boq.id} />
            <FormGrid cols={4}>
              <Field label="Department">
                <Select name="boqDepartmentId" required defaultValue={depts[0]?.id} options={depts.map((d) => ({ value: d.id, label: d.label }))} />
              </Field>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-sm font-semibold">Device type</span>
                <DevicePicker options={devices} required />
              </div>
              <Field label="Quantity"><Input name="quantity" type="number" min={1} defaultValue={1} required /></Field>
              <Field label={`Unit price (${boq.currency})`} hint="Leave empty to use the catalogue estimate.">
                <Input name="unitPrice" type="number" min={0} step="0.01" />
              </Field>
              <Field label="Notes" className="sm:col-span-2"><Input name="notes" placeholder="Why this line is needed" /></Field>
              <div className="flex items-end"><Button>Add line</Button></div>
            </FormGrid>
            <p className="mt-2 text-xs text-muted">Lines added by hand are never changed by regeneration.</p>
          </form>
        </Panel>
      )}
      <p className="text-right text-sm text-muted">{formatNumber(lines.length)} lines · {formatNumber(lines.reduce((s, l) => s + l.quantity, 0))} units</p>
    </div>
  );
}

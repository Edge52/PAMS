"use client";
import { useActionState, useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { formatMoney, formatNumber } from "@/lib/format";
import { keepInputs } from "@/lib/submit-keep";

type FormState = { error?: string; ok?: string } | undefined;

export interface LineRowData {
  id: number;
  deviceCode: string;
  deviceName: string;
  tier: string;
  quantity: number;
  calculatedQty: number;
  isOverridden: boolean;
  isManual: boolean;
  unitPriceEstimate: string | null;
  amount: number;
  calcExplanation: string | null;
  notes: string | null;
}

const TIER_TONE: Record<string, "primary" | "info" | "neutral"> = { ESSENTIAL: "primary", RECOMMENDED: "info", OPTIONAL: "neutral" };
const TIER_LABEL: Record<string, string> = { ESSENTIAL: "Essential", RECOMMENDED: "Recommended", OPTIONAL: "Optional" };

/** One BOQ line as a table row, with an inline editor (quantity, unit price, notes) that posts to a server action. */
export function LineRow({ line, currency, locked, showWhy, updateAction, deleteAction, tab }: {
  line: LineRowData; currency: string; locked: boolean; showWhy: boolean; tab: string;
  updateAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  deleteAction: (fd: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await updateAction(prev, fd);
    if (res?.ok) setEditing(false);
    return res;
  }, undefined);
  const why = line.calcExplanation ?? "";

  return (
    <>
      <tr className={editing ? "bg-primary-soft/40" : "hover:bg-sunken/50"}>
        <td className="border-b border-line px-3 py-2 align-top">
          <span className="font-semibold">{line.deviceName}</span>
          <span className="ml-1.5 font-mono text-xs text-muted">{line.deviceCode}</span>
          {line.isManual && <span className="ml-1.5"><Badge tone="info">Added by hand</Badge></span>}
          {showWhy && why && !line.isManual && <span className="mt-0.5 block text-xs text-muted">{why}</span>}
          {line.notes && <span className="mt-0.5 block text-xs text-ink/80">Note: {line.notes}</span>}
        </td>
        <td className="border-b border-line px-3 py-2 align-top"><Badge tone={TIER_TONE[line.tier] ?? "neutral"}>{TIER_LABEL[line.tier] ?? line.tier}</Badge></td>
        <td className="border-b border-line px-3 py-2 text-right align-top" title={why || undefined}>
          <span className="font-semibold">{formatNumber(line.quantity)}</span>
          {line.isOverridden && (
            <span className="ml-1 inline-block align-middle"><Badge tone="warn">Override</Badge></span>
          )}
        </td>
        <td className="border-b border-line px-3 py-2 text-right align-top text-muted" title={why || undefined}>
          {line.isManual ? "—" : formatNumber(line.calculatedQty)}
        </td>
        <td className="border-b border-line px-3 py-2 text-right align-top whitespace-nowrap">
          {line.unitPriceEstimate === null ? <span className="text-warn">No price</span> : formatMoney(line.unitPriceEstimate, currency)}
        </td>
        <td className="border-b border-line px-3 py-2 text-right align-top font-semibold whitespace-nowrap">{formatMoney(line.amount, currency)}</td>
        <td className="border-b border-line px-3 py-2 text-right align-top whitespace-nowrap">
          {!locked && (
            <button type="button" className="rounded px-2 py-0.5 text-sm font-semibold text-primary hover:bg-primary-soft"
              aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? "Close" : "Edit"}
            </button>
          )}
        </td>
      </tr>
      {editing && !locked && (
        <tr className="bg-primary-soft/40">
          <td colSpan={7} className="border-b border-line px-3 pb-3 pt-1">
            <form onSubmit={keepInputs(formAction, { busy: pending })} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="lineId" value={line.id} />
              <label className="block w-28">
                <span className="mb-1 block text-xs font-semibold">Quantity</span>
                <Input name="quantity" type="number" min={0} step={1} required defaultValue={line.quantity} className="text-right" />
              </label>
              <label className="block w-40">
                <span className="mb-1 block text-xs font-semibold">Unit price ({currency})</span>
                <Input name="unitPrice" type="number" min={0} step="0.01" defaultValue={line.unitPriceEstimate ?? ""} className="text-right" />
              </label>
              <label className="block min-w-48 flex-1">
                <span className="mb-1 block text-xs font-semibold">Notes</span>
                <Input name="notes" defaultValue={line.notes ?? ""} placeholder="e.g. client asked for one spare" />
              </label>
              <Button disabled={pending}>{pending ? "Saving…" : "Save line"}</Button>
              {line.isOverridden && (
                <Button name="reset" value="1" variant="secondary" disabled={pending} title={`Back to the standard's ${line.calculatedQty}`}>
                  Reset to {line.calculatedQty}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </form>
            {!line.isManual && (
              <p className="mt-2 text-xs text-muted">
                Standard: {why || "—"}. Changing the quantity marks the line as an override; regeneration keeps your figure.
              </p>
            )}
            {state?.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
            <form action={deleteAction} className="mt-2"
              onSubmit={(e) => { if (!confirm(`Remove ${line.deviceName} from this BOQ?`)) e.preventDefault(); }}>
              <input type="hidden" name="lineId" value={line.id} />
              <input type="hidden" name="tab" value={tab} />
              <button className="text-sm text-danger hover:underline">Delete this line</button>
              {!line.isManual && <span className="ml-2 text-xs text-muted">It returns on the next regeneration while the rule exists — set the quantity to 0 to keep it out.</span>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

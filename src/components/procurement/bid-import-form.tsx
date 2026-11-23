"use client";
/**
 * "Import a bid from Excel" (wave 38): choose the invited supplier and the filled template, check it (errors and the
 * lines read, nothing saved), then import. The form is submitted through a transition so the chosen file stays
 * selected between the two steps; the server reads and checks the file again on import.
 */
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, Field, Select } from "@/components/ui";
import { FormMessages } from "@/components/ui/action-form";
import { bidImportAction } from "@/app/procurement/rfqs/bid-import-actions";
import type { BidImportState } from "@/lib/procurement/bid-import-view";
import { formatMoney, formatNumber } from "@/lib/format";

export function BidImportForm({ rfqId, suppliers }: { rfqId: number; suppliers: { id: number; name: string }[] }) {
  const [state, run, pending] = useActionState<BidImportState, FormData>(bidImportAction, null);
  // The check shown belongs to the file and supplier chosen when it ran; a change makes it stale.
  const [stale, setStale] = useState(true);
  const p = state?.preview;
  const ready = !stale && !!p && p.errors.length === 0 && !state?.imported;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    setStale(false);
    startTransition(() => run(fd));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" aria-busy={pending || undefined}>
      <input type="hidden" name="rfqId" value={rfqId} />
      <Field label="Supplier">
        <Select name="supplierId" required placeholder="Choose an invited supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} onChange={() => setStale(true)} />
      </Field>
      <Field label="Filled bid template (.xlsx)">
        <input type="file" name="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={() => setStale(true)}
          className="block w-full text-sm file:mr-3 file:rounded-[var(--radius-control)] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" name="intent" value="check" disabled={pending}>{pending ? "Working…" : "Check the file"}</Button>
        <Button name="intent" value="import" disabled={pending || !ready}>Import bid</Button>
      </div>
      {!ready && !state?.imported && <p className="text-xs text-muted">Check the file first; Import bid saves it as a received offer.</p>}
      <FormMessages state={state ? { errors: state.errors, message: state.message } : null} />
      {p && !stale && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">{p.supplier}{p.reference ? ` · ${p.reference}` : ""}{p.offerDate ? ` · ${p.offerDate}` : ""}{p.validUntil ? ` · valid until ${p.validUntil}` : ""}{p.currency ? ` · ${p.currency}` : ""}{p.incoterm ? ` · ${p.incoterm}` : ""}</p>
          {p.replaces && !state?.imported && <p className="text-warn">Replaces offer {p.replaces}.</p>}
          {p.errors.length > 0 && (
            <div role="alert" className="rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-danger">
              <p className="font-semibold">Fix these in the file, then check it again</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{p.errors.slice(0, 40).map((e, i) => <li key={i}><b>{e.where}:</b> {e.message}</li>)}</ul>
              {p.errors.length > 40 && <p className="mt-1">And {p.errors.length - 40} more.</p>}
            </div>
          )}
          {p.warnings.length > 0 && (
            <div className="rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-warn">
              <p className="font-semibold">Check</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{p.warnings.slice(0, 20).map((e, i) => <li key={i}><b>{e.where}:</b> {e.message}</li>)}</ul>
            </div>
          )}
          {p.lines.length > 0 && (
            <div className="overflow-x-auto rounded-[var(--radius-control)] border border-line" tabIndex={0} role="region" aria-label="Lines read from the file">
              <table className="w-full text-xs">
                <thead className="bg-sunken text-left"><tr>
                  <th className="px-2 py-1.5">Item</th><th className="px-2 py-1.5 text-right">Qty</th>
                  {p.pricesShown && <><th className="px-2 py-1.5 text-right">Unit price</th><th className="px-2 py-1.5 text-right">Discount</th></>}
                  <th className="px-2 py-1.5">Make and model</th><th className="px-2 py-1.5">Origin</th><th className="px-2 py-1.5 text-right">Delivery</th><th className="px-2 py-1.5 text-right">Warranty</th><th className="px-2 py-1.5">Compliance</th>
                </tr></thead>
                <tbody className="divide-y divide-line">{p.lines.map((l) => (
                  <tr key={l.code}>
                    <td className="px-2 py-1.5"><span className="font-semibold">{l.name}</span><span className="block text-muted">{l.code}</span></td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(l.quantity)}</td>
                    {p.pricesShown && <><td className="px-2 py-1.5 text-right whitespace-nowrap">{l.unitPrice != null ? formatMoney(l.unitPrice, p.currency ?? "USD") : "—"}</td><td className="px-2 py-1.5 text-right">{l.discountPct ? `${l.discountPct} %` : "—"}</td></>}
                    <td className="px-2 py-1.5">{[l.make, l.model].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-2 py-1.5">{l.origin ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.deliveryWeeks != null ? `${l.deliveryWeeks} weeks` : "—"}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.warrantyMonths != null ? `${l.warrantyMonths} months` : "—"}</td>
                    <td className="px-2 py-1.5">{l.specItems ? `${l.answered} of ${l.specItems} answered` : "No specification"}{l.mandatoryNo ? <span className="block text-danger">{l.mandatoryNo} mandatory not met</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {p.pricesNote && <p className="text-xs text-muted">{p.pricesNote}</p>}
          {p.notQuoted.length > 0 && <p className="text-xs text-muted">Not quoted: {p.notQuoted.join(", ")}.</p>}
        </div>
      )}
    </form>
  );
}

"use client";

import { useState } from "react";
import type { EditableOfferLine } from "@/lib/procurement/offer-lines";

type Row = EditableOfferLine & { key: string };
export type DeviceTypeOption = { id: number; code: string; name: string };
export type BoqLineOption = { id: number; deviceTypeId: number; label: string };

let seq = 0;
const omitKey = <T extends { key: string }>(r: T): Omit<T, "key"> => { const o: Partial<T> = { ...r }; delete o.key; return o as Omit<T, "key">; };
const k = () => `l${++seq}`;
const cell = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[13px] focus:border-primary focus:outline-none";
const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n); } catch { return `${c} ${n.toFixed(2)}`; }
};

const blank = (): Row => ({
  key: k(), deviceTypeId: null, boqLineId: null, description: "", manufacturer: "", model: "", countryOfOrigin: "",
  quantity: 1, unitPrice: 0, discountPct: 0, isOptional: false,
});

/** Offer line grid. Posts the rows as JSON in a hidden "lines" field of the surrounding form. */
export function OfferLinesEditor({ initial, deviceTypes, boqLines, currencyField = "currency", defaultCurrency }: {
  initial: EditableOfferLine[]; deviceTypes: DeviceTypeOption[]; boqLines: BoqLineOption[]; currencyField?: string; defaultCurrency: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => (initial.length ? initial.map((l) => ({ ...l, key: k() })) : [blank()]));
  const [currency, setCurrency] = useState(defaultCurrency);
  const set = (key: string, patch: Partial<EditableOfferLine>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.filter((r) => !r.isOptional).reduce((s, r) => s + (r.quantity || 0) * (r.unitPrice || 0) * (1 - (r.discountPct || 0) / 100), 0);
  const optional = rows.filter((r) => r.isOptional).reduce((s, r) => s + (r.quantity || 0) * (r.unitPrice || 0) * (1 - (r.discountPct || 0) / 100), 0);
  const dtName = (id: number | null) => deviceTypes.find((d) => d.id === id)?.name ?? "";

  return (
    <div
      ref={(el) => {
        // Follow the offer currency select that lives elsewhere in the same form.
        const sel = el?.closest("form")?.querySelector<HTMLSelectElement>(`select[name="${currencyField}"]`);
        if (!sel) return;
        const onChange = () => setCurrency(sel.value);
        sel.addEventListener("change", onChange);
        return () => sel.removeEventListener("change", onChange);
      }}
    >
      <input type="hidden" name="lines" value={JSON.stringify(rows.map((r) => omitKey(r)))} />
      <div className="space-y-3">
        {rows.map((r, idx) => {
          const boqOpts = boqLines.filter((b) => b.deviceTypeId === r.deviceTypeId);
          const net = (r.quantity || 0) * (r.unitPrice || 0) * (1 - (r.discountPct || 0) / 100);
          return (
            <fieldset key={r.key} className="rounded-[var(--radius-panel)] border border-line p-3">
              <legend className="px-1 text-xs font-semibold text-muted">Line {idx + 1}{r.isOptional ? " (optional)" : ""}</legend>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="col-span-2 block">
                  <span className="mb-0.5 block text-xs text-muted">Device type</span>
                  <select value={r.deviceTypeId ?? ""} className={cell} required
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const firstBoq = boqLines.find((b) => b.deviceTypeId === id);
                      set(r.key, { deviceTypeId: id, boqLineId: firstBoq?.id ?? null, description: r.description || (deviceTypes.find((d) => d.id === id)?.name ?? "") });
                    }}>
                    <option value="">Choose…</option>
                    {deviceTypes.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                  </select>
                </label>
                {boqLines.length > 0 && (
                  <label className="col-span-2 block">
                    <span className="mb-0.5 block text-xs text-muted">BOQ line</span>
                    <select value={r.boqLineId ?? ""} onChange={(e) => set(r.key, { boqLineId: e.target.value ? Number(e.target.value) : null })} className={cell}>
                      <option value="">Not linked</option>
                      {boqOpts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </label>
                )}
                <label className={`block ${boqLines.length > 0 ? "col-span-2" : "col-span-2 md:col-span-4"}`}>
                  <span className="mb-0.5 block text-xs text-muted">Description</span>
                  <input value={r.description} placeholder={dtName(r.deviceTypeId)} onChange={(e) => set(r.key, { description: e.target.value })} className={cell} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Manufacturer</span>
                  <input value={r.manufacturer} onChange={(e) => set(r.key, { manufacturer: e.target.value })} className={cell} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Model</span>
                  <input value={r.model} onChange={(e) => set(r.key, { model: e.target.value })} className={cell} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Origin</span>
                  <input value={r.countryOfOrigin} onChange={(e) => set(r.key, { countryOfOrigin: e.target.value })} className={cell} placeholder="e.g. China, Germany" />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Quantity</span>
                  <input type="number" min={1} step={1} value={r.quantity} onChange={(e) => set(r.key, { quantity: Number(e.target.value) })} className={cell} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Unit price ({currency})</span>
                  <input type="number" min={0} step="0.01" value={r.unitPrice} onChange={(e) => set(r.key, { unitPrice: Number(e.target.value) })} className={cell} />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-xs text-muted">Discount %</span>
                  <input type="number" min={0} max={100} step="0.1" value={r.discountPct} onChange={(e) => set(r.key, { discountPct: Number(e.target.value) })} className={cell} />
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.isOptional} onChange={(e) => set(r.key, { isOptional: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
                  Optional item (not in the offer total)
                </label>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums">Line total <strong>{money(net, currency)}</strong></span>
                  <button type="button" onClick={() => setRows((rs) => [...rs.slice(0, idx + 1), { ...r, key: k(), id: undefined }, ...rs.slice(idx + 1)])} className="text-primary hover:underline">Duplicate</button>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-danger hover:underline">Remove</button>
                </span>
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Add line</button>
        <p className="text-sm">Offer total <strong className="tabular-nums">{money(total, currency)}</strong>
          {optional > 0 && <span className="ml-2 text-muted">+ {money(optional, currency)} optional</span>}</p>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/procurement/forms";
import type { EditableSpecItem } from "@/lib/procurement/spec-items";
import { FormMessages, SubmitButton } from "./action-form";
import { keepInputs } from "@/lib/submit-keep";

type Row = EditableSpecItem & { key: string };
let seq = 0;
const omitKey = <T extends { key: string }>(r: T): Omit<T, "key"> => { const o: Partial<T> = { ...r }; delete o.key; return o as Omit<T, "key">; };
const newKey = () => `r${++seq}`;

const cell = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[13px] focus:border-primary focus:outline-none";

/** Editable spec item grid: add / remove / reorder rows, posted as JSON to the save action. */
export function SpecEditor({ action, items, title, notes, sections }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  items: EditableSpecItem[]; title: string; notes: string; sections: string[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [rows, setRows] = useState<Row[]>(() => items.map((i) => ({ ...i, key: newKey() })));
  const [dirty, setDirty] = useState(false);
  // After a save the server re-renders with fresh ids: adopt them so the next save updates instead of re-inserting.
  const [source, setSource] = useState(items);
  if (items !== source) {
    setSource(items);
    setRows(items.map((i) => ({ ...i, key: newKey() })));
  }

  const update = (key: string, patch: Partial<EditableSpecItem>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const move = (idx: number, dir: -1 | 1) => {
    setRows((rs) => {
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
    setDirty(true);
  };
  const remove = (key: string) => { setRows((rs) => rs.filter((r) => r.key !== key)); setDirty(true); };
  const add = (after?: number) => {
    const section = after != null ? rows[after]?.section ?? "" : rows.at(-1)?.section ?? "";
    const row: Row = { key: newKey(), section, parameter: "", requirement: "", unit: "", mandatory: true, weight: 1 };
    setRows((rs) => (after == null ? [...rs, row] : [...rs.slice(0, after + 1), row, ...rs.slice(after + 1)]));
    setDirty(true);
  };

  const totalWeight = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const mandatory = rows.filter((r) => r.mandatory).length;

  return (
    <form onSubmit={keepInputs(formAction, { busy: pending, before: () => setDirty(false) })} className="space-y-4">
      <input type="hidden" name="items" value={JSON.stringify(rows.map((r) => omitKey(r)))} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="block md:col-span-2">
          <span className="mb-1 block text-sm font-semibold">Title</span>
          <input name="title" defaultValue={title} required className={cell} onChange={() => setDirty(true)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Notes for bidders</span>
          <input name="notes" defaultValue={notes} className={cell} onChange={() => setDirty(true)} placeholder="Optional" />
        </label>
      </div>

      <datalist id="spec-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
        <table className="w-full min-w-[920px] border-collapse text-[13px]">
          <thead className="bg-sunken text-left text-muted">
            <tr>
              <th className="w-10 px-2 py-2 font-semibold">#</th>
              <th className="w-36 px-2 py-2 font-semibold">Section</th>
              <th className="w-48 px-2 py-2 font-semibold">Parameter</th>
              <th className="px-2 py-2 font-semibold">Requirement</th>
              <th className="w-20 px-2 py-2 font-semibold">Unit</th>
              <th className="w-24 px-2 py-2 text-center font-semibold">Mandatory</th>
              <th className="w-20 px-2 py-2 font-semibold">Weight</th>
              <th className="w-36 px-2 py-2"><span className="sr-only">Row actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No parameters yet. Add the first one below.</td></tr>
            )}
            {rows.map((r, idx) => (
              <tr key={r.key} className="border-t border-line align-top">
                <td className="px-2 py-1.5 text-muted tabular-nums">{idx + 1}</td>
                <td className="px-1 py-1"><input aria-label={`Section, row ${idx + 1}`} list="spec-sections" value={r.section} onChange={(e) => update(r.key, { section: e.target.value })} className={cell} /></td>
                <td className="px-1 py-1"><input aria-label={`Parameter, row ${idx + 1}`} value={r.parameter} onChange={(e) => update(r.key, { parameter: e.target.value })} className={cell} /></td>
                <td className="px-1 py-1"><textarea aria-label={`Requirement, row ${idx + 1}`} rows={1} value={r.requirement} onChange={(e) => update(r.key, { requirement: e.target.value })} className={`${cell} min-h-[30px] resize-y`} /></td>
                <td className="px-1 py-1"><input aria-label={`Unit, row ${idx + 1}`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} className={cell} /></td>
                <td className="px-1 py-1 text-center">
                  <input type="checkbox" aria-label={`Mandatory, row ${idx + 1}`} checked={r.mandatory} onChange={(e) => update(r.key, { mandatory: e.target.checked })} className="mt-1.5 size-4 accent-[var(--color-primary)]" />
                </td>
                <td className="px-1 py-1"><input aria-label={`Weight, row ${idx + 1}`} type="number" min={0} max={100} step="0.5" value={r.weight} onChange={(e) => update(r.key, { weight: Number(e.target.value) })} className={cell} /></td>
                <td className="whitespace-nowrap px-1 py-1 text-right">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="rounded px-1.5 py-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move row ${idx + 1} up`}>↑</button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} className="rounded px-1.5 py-1 text-muted hover:bg-sunken disabled:opacity-30" aria-label={`Move row ${idx + 1} down`}>↓</button>
                  <button type="button" onClick={() => add(idx)} className="rounded px-1.5 py-1 text-primary hover:bg-primary-soft" aria-label={`Insert a row after row ${idx + 1}`}>+</button>
                  <button type="button" onClick={() => remove(r.key)} className="rounded px-1.5 py-1 text-danger hover:bg-danger-soft" aria-label={`Remove row ${idx + 1}`}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => add()} className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Add parameter</button>
        <SubmitButton pending={pending}>Save specification</SubmitButton>
        <span className="text-xs text-muted">
          {rows.length} parameters · {mandatory} mandatory · total weight {Math.round(totalWeight * 10) / 10}
          {dirty && <span className="ml-2 font-semibold text-warn">Unsaved changes</span>}
        </span>
      </div>
      <p className="text-xs text-muted">
        Technical score = weighted share of parameters an offer complies with (partial counts half). An offer that fails any mandatory parameter is
        technically non-responsive. Removing a parameter also removes the compliance answers recorded against it.
      </p>
      <FormMessages state={state} />
    </form>
  );
}

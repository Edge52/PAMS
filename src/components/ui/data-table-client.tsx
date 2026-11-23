"use client";
/**
 * The interactive parts of <DataTable> (wave 38): the column chooser, "select all" and the bulk-actions bar. The table
 * itself is drawn on the server; these only add to it, so the list still sorts, links and submits without JavaScript.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { columnsStorageKey, hiddenColumns, hideCss, type ColumnInfo } from "./data-table-utils";
import { ConfirmDialog, confirmTone } from "./confirm";

const CHANGED = "hpams:table-columns";
const read = (id: string): string | null => { try { return window.localStorage.getItem(columnsStorageKey(id)); } catch { return null; } };
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb); window.addEventListener(CHANGED, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(CHANGED, cb); };
};

/** Which optional columns show. Remembered in this browser (localStorage); the server draws the default set. */
export function ColumnChooser({ id, columns }: { id: string; columns: (ColumnInfo & { label: string })[] }) {
  const stored = useSyncExternalStore(subscribe, () => read(id), () => null);
  const hidden = hiddenColumns(stored, columns);
  const optional = columns.filter((c) => c.optional);
  function toggle(key: string, show: boolean) {
    const next = show ? hidden.filter((k) => k !== key) : [...hidden, key];
    try { window.localStorage.setItem(columnsStorageKey(id), JSON.stringify(next)); } catch { /* private window: not remembered */ }
    window.dispatchEvent(new Event(CHANGED));
  }
  function reset() {
    try { window.localStorage.removeItem(columnsStorageKey(id)); } catch { /* nothing to clear */ }
    window.dispatchEvent(new Event(CHANGED));
  }
  const css = hideCss(id, hidden);
  return (
    <>
      {css && <style>{css}</style>}
      <details className="relative">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold hover:bg-sunken [&::-webkit-details-marker]:hidden">
          Columns{hidden.length > 0 && <span className="text-xs font-normal text-muted">({hidden.length} hidden)</span>}
        </summary>
        <fieldset className="absolute right-0 z-30 mt-1 w-56 rounded-[var(--radius-panel)] border border-line bg-surface p-2 shadow-lg">
          <legend className="sr-only">Columns to show</legend>
          {optional.map((c) => (
            <label key={c.key} className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm hover:bg-sunken">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              {c.label}
            </label>
          ))}
          <button type="button" onClick={reset} className="mt-1 w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left text-xs text-primary hover:bg-sunken">Back to the usual columns</button>
        </fieldset>
      </details>
    </>
  );
}

const boxes = (form: string, name: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${CSS.escape(form)}"][name="${CSS.escape(name)}"]`)];

/** The heading checkbox: selects or clears every row on the page. */
export function SelectAll({ form, name, label }: { form: string; name: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const sync = () => {
      const all = boxes(form, name), on = all.filter((b) => b.checked).length;
      if (ref.current) { ref.current.checked = on > 0 && on === all.length; ref.current.indeterminate = on > 0 && on < all.length; }
    };
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [form, name]);
  return (
    <input ref={ref} type="checkbox" aria-label={label} className="size-4 accent-[var(--color-primary)]"
      onChange={(e) => { for (const b of boxes(form, name)) b.checked = e.target.checked; document.dispatchEvent(new Event("change")); }} />
  );
}

export type BulkActionProps = {
  label: string;
  /** A server action taking the form data (selected ids under `name`), or a page address opened with the ids (GET). */
  action: string | ((fd: FormData) => void | Promise<void>);
  confirm?: string;
  primary?: boolean;
};

/** The bar under the table: how many rows are ticked and what can be done with them. */
export function BulkBar({ form, name, actions, what }: { form: string; name: string; actions: BulkActionProps[]; what: string }) {
  const [count, setCount] = useState<number | null>(null); // null until the first tick: buttons stay usable without JavaScript
  const dialog = useRef<HTMLDialogElement>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const sync = () => setCount(boxes(form, name).filter((b) => b.checked).length);
    document.addEventListener("change", sync);
    window.addEventListener("pageshow", sync);
    return () => { document.removeEventListener("change", sync); window.removeEventListener("pageshow", sync); };
  }, [form, name]);
  const none = count === 0;
  return (
    <div role="group" aria-label={`With the selected ${what}`} className="flex flex-wrap items-center gap-2 text-sm">
      <span aria-live="polite" className="text-muted">{count ? <><b className="text-ink">{count}</b> selected</> : `Tick ${what} to act on several at once.`}</span>
      {actions.map((a, i) => {
        const cls = `inline-flex min-h-9 items-center rounded-full border px-4 font-semibold disabled:pointer-events-none disabled:opacity-50 ${a.primary ? "border-primary bg-primary text-on-primary hover:bg-primary-strong" : "border-line bg-surface hover:bg-sunken"}`;
        const get = typeof a.action === "string";
        return (
          <button key={a.label} ref={(el) => { btns.current[i] = el; }} type="submit" form={form} disabled={none} className={cls}
            formAction={a.action} formMethod={get ? "get" : undefined} formNoValidate
            onClick={a.confirm ? (e) => { e.preventDefault(); setAsking(i); dialog.current?.showModal(); } : undefined}>
            {a.label}
          </button>
        );
      })}
      {actions.some((a) => a.confirm) && (
        <ConfirmDialog dialog={dialog} message={asking !== null ? actions[asking].confirm : ""} tone={confirmTone(asking !== null ? actions[asking].confirm ?? "" : "")}
          confirmLabel={asking !== null ? actions[asking].label : undefined}
          onAnswer={(yes) => {
            if (dialog.current?.open) dialog.current.close();
            const b = asking !== null ? btns.current[asking] : null;
            setAsking(null);
            if (yes && b?.form) b.form.requestSubmit(b);
          }} />
      )}
    </div>
  );
}

"use client";
/** CSV / Excel import (wave 41): template → upload and check (a report per row) → import the valid rows. */
import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import type { ImportState } from "@/lib/imports/state";

type Act = (prev: ImportState, fd: FormData) => Promise<ImportState>;

export function ImportWizard({ templateHref, columns, preview, commit, fields, again, what = "rows", note }: {
  templateHref: string; columns: { key: string; header: string }[]; preview: Act; commit: Act;
  /** Extra inputs for the upload form (a hospital to import into…). */
  fields?: ReactNode; again: string; what?: string; note?: ReactNode;
}) {
  const [pv, previewAction, previewing] = useActionState(preview, null);
  const [done, commitAction, committing] = useActionState(commit, null);

  if (done?.done) {
    return (
      <div role="status" className="rounded-[var(--radius-panel)] border border-ok bg-ok-soft p-5">
        <p className="font-semibold text-ok">{done.done}</p>
        <div className="mt-3 flex gap-2 text-sm">
          {done.doneHref && <Link href={done.doneHref} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 font-semibold text-on-primary">{done.doneLabel ?? "Open"}</Link>}
          <a href={again} className="px-3 py-1.5 font-semibold text-primary">Import another file</a>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-1 text-[15px] font-semibold">1 · Fill in the template</h2>
        <p className="mb-3 text-sm text-muted">One row per {what.replace(/s$/, "")}. The workbook explains each column and lists the valid codes. Save it as .xlsx or CSV.</p>
        {note}
        <a href={templateHref} className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Download template (.xlsx)</a>
      </section>
      <form action={previewAction} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-3 text-[15px] font-semibold">2 · Upload and check</h2>
        <div className="flex flex-wrap items-end gap-3">
          {fields}
          <label className="block"><span className="mb-1 block text-sm font-semibold">File</span>
            <input type="file" name="file" required accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" /></label>
          <button disabled={previewing} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-strong disabled:opacity-50">
            {previewing ? "Checking…" : "Check the file"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">Nothing is saved yet: you see a report of every row first.</p>
        {pv?.error && <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{pv.error}</p>}
      </form>
      {pv?.rows && (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-semibold">3 · Check report: {pv.fileName}</h2>
            <p className="text-sm" aria-live="polite"><b className="text-ok">{pv.validCount} ready</b>{pv.errorCount ? <> · <b className="text-danger">{pv.errorCount} with errors</b></> : null}</p>
          </div>
          {!!pv.unknownHeaders?.length && <p className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn">Columns not used: {pv.unknownHeaders.join(", ")}</p>}
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-sunken text-left text-muted"><tr>
                <th className="px-3 py-2 font-semibold">Row</th>{columns.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">{c.header}</th>)}<th className="px-3 py-2 font-semibold">Check</th>
              </tr></thead>
              <tbody>
                {pv.rows.map((r) => (
                  <tr key={r.rowNumber} className={`border-t border-line align-top ${r.errors.length ? "bg-danger-soft" : ""}`}>
                    <td className="px-3 py-1.5 font-mono">{r.rowNumber}</td>
                    {columns.map((c) => <td key={c.key} className="px-3 py-1.5">{r.values[c.key] ?? <span className="text-faint">—</span>}</td>)}
                    <td className="min-w-[14rem] px-3 py-1.5">
                      {r.errors.length ? <ul className="space-y-0.5 text-danger">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="font-semibold text-ok">Ready</span>}
                      {!!r.warnings?.length && <ul className="mt-0.5 space-y-0.5 text-warn">{r.warnings.map((e) => <li key={e}>{e}</li>)}</ul>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={commitAction} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <input type="hidden" name="payload" value={pv.payload ?? ""} />
            <button disabled={!pv.validCount || committing} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-on-primary hover:bg-primary-strong disabled:opacity-50">
              {committing ? "Importing…" : `Import ${pv.validCount} ${pv.validCount === 1 ? what.replace(/s$/, "") : what}`}
            </button>
            <span className="text-sm text-muted">{pv.errorCount ? "Rows with errors are skipped. Fix them in the file and import them later." : "All rows are valid."}</span>
            {done?.error && <p role="alert" className="w-full text-sm text-danger">{done.error}</p>}
          </form>
        </section>
      )}
    </div>
  );
}

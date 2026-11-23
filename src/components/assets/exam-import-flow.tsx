"use client";
/** Exam count import (wave 38): upload → preview with errors per row → save the valid rows. */
import Link from "next/link";
import { useActionState } from "react";
import type { ExamPreview } from "@/app/assets/imaging/import/actions";

type Act = (prev: ExamPreview, fd: FormData) => Promise<ExamPreview>;
const btn = "rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-50";

export function ExamImportFlow({ preview, commit }: { preview: Act; commit: Act }) {
  const [pv, previewAction, previewing] = useActionState(preview, null);
  const [done, commitAction, committing] = useActionState(commit, null);

  if (done?.done) {
    return (
      <div role="status" className="rounded-[var(--radius-panel)] border border-ok bg-ok-soft p-5">
        <p className="font-semibold text-ok">{done.done}</p>
        <div className="mt-3 flex gap-3 text-sm">
          <Link href="/assets/imaging" className="font-semibold text-primary">Open imaging use</Link>
          <Link href="/assets/imaging/import" className="font-semibold text-primary">Import another file</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <form action={previewAction} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-3 text-[15px] font-semibold">1 · Upload and check</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mb-1 block text-sm font-semibold">CSV or Excel file</span>
            <input type="file" name="file" required accept=".csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" /></label>
          <button disabled={previewing} className={btn}>{previewing ? "Checking…" : "Check the file"}</button>
        </div>
        {pv?.error && <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{pv.error}</p>}
        {done?.error && <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{done.error}</p>}
      </form>
      {pv?.rows && (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-semibold">2 · Preview — {pv.fileName}</h2>
            <p className="text-sm" aria-live="polite"><b className="text-ok">{pv.validCount} ready</b> ({pv.days} device-days){pv.errorCount ? <> · <b className="text-danger">{pv.errorCount} rows with errors</b></> : null}</p>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-sunken text-left text-muted"><tr>
                {["Row", "Device", "Asset", "Date", "Exams", "Modality", "Procedure", "Check"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>{pv.rows.map((r) => (
                <tr key={r.rowNumber} className={`border-t border-line align-top ${r.errors.length ? "bg-danger-soft" : ""}`}>
                  <td className="px-3 py-1.5 font-mono">{r.rowNumber}</td><td className="px-3 py-1.5">{r.device}</td><td className="px-3 py-1.5 font-mono">{r.tag ?? ""}</td>
                  <td className="px-3 py-1.5">{r.date}</td><td className="px-3 py-1.5 text-right">{r.exams}</td><td className="px-3 py-1.5">{r.modality}</td><td className="px-3 py-1.5">{r.procedure}</td>
                  <td className="min-w-[14rem] px-3 py-1.5">{r.errors.length ? <ul className="space-y-0.5 text-danger">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="font-semibold text-ok">Ready</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <form action={commitAction} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <input type="hidden" name="payload" value={pv.payload ?? ""} />
            <button disabled={!pv.validCount || committing} className={btn}>{committing ? "Saving…" : `Save ${pv.days} device-day${pv.days === 1 ? "" : "s"}`}</button>
            <p className="text-sm text-muted">Each device-day in the file replaces what was imported for it before. Rows with errors are left out.</p>
          </form>
        </section>
      )}
    </div>
  );
}

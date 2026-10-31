"use client";
/** Excel import: upload → validated preview (errors per row) → import the valid rows. */
import Link from "next/link";
import { useActionState } from "react";
import { IMPORT_COLUMNS } from "@/lib/assets/import";
import type { ImportPreview } from "@/app/assets/actions";

type Act = (prev: ImportPreview, fd: FormData) => Promise<ImportPreview>;
const SHOWN = ["deviceTypeCode", "roomCode", "departmentCode", "manufacturer", "model", "serialNumber", "status", "installDate", "warrantyMonths"] as const;

export function ImportFlow({ facilities, preview, commit }: { facilities: { id: number; code: string; name: string }[]; preview: Act; commit: Act }) {
  const [pv, previewAction, previewing] = useActionState(preview, null);
  const [done, commitAction, committing] = useActionState(commit, null);
  const header = (k: string) => IMPORT_COLUMNS.find((c) => c.key === k)?.header ?? k;

  if (done?.done) {
    return (
      <div role="status" className="rounded-[var(--radius-panel)] border border-ok bg-ok-soft p-5">
        <p className="font-semibold text-ok">{done.done}</p>
        <div className="mt-3 flex gap-2 text-sm">
          <Link href="/assets?sort=tag" className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 font-semibold text-white">Open the register</Link>
          <Link href="/assets/map" className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 font-semibold">See them on the floor map</Link>
          <Link href="/assets/import" className="px-3 py-1.5 font-semibold text-primary">Import another file</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-1 text-[15px] font-semibold">1 · Fill in the template</h2>
        <p className="mb-3 text-sm text-muted">One row per unit. The workbook includes sheets listing every valid device type code and room code.</p>
        <a href={`/assets/import/template${facilities[0] ? `?facilityId=${facilities[0].id}` : ""}`} className="inline-flex rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken">Download template (.xlsx)</a>
      </section>
      <form action={previewAction} className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
        <h2 className="mb-3 text-[15px] font-semibold">2 · Upload and check</h2>
        <div className="flex flex-wrap items-end gap-3">
          {facilities.length > 1 ? (
            <label className="block"><span className="mb-1 block text-sm font-semibold">Facility</span>
              <select name="facilityId" className="rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px]">{facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}</select></label>
          ) : <input type="hidden" name="facilityId" value={facilities[0]?.id ?? ""} />}
          <label className="block"><span className="mb-1 block text-sm font-semibold">Workbook</span>
            <input type="file" name="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" /></label>
          <button disabled={previewing} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
            {previewing ? "Checking…" : "Check the file"}
          </button>
        </div>
        {pv?.error && <p role="alert" className="mt-3 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{pv.error}</p>}
      </form>

      {pv?.rows && (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-[15px] font-semibold">3 · Preview — {pv.fileName}</h2>
            <p className="text-sm" aria-live="polite"><b className="text-ok">{pv.validCount} ready</b>{pv.errorCount ? <> · <b className="text-danger">{pv.errorCount} with errors</b></> : null}</p>
          </div>
          {!!pv.unknownHeaders?.length && <p className="border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn">Ignored columns: {pv.unknownHeaders.join(", ")}</p>}
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-sunken text-left text-muted"><tr>
                <th className="px-3 py-2 font-semibold">Row</th>{SHOWN.map((k) => <th key={k} className="whitespace-nowrap px-3 py-2 font-semibold">{header(k)}</th>)}<th className="px-3 py-2 font-semibold">Check</th>
              </tr></thead>
              <tbody>
                {pv.rows.map((r) => (
                  <tr key={r.rowNumber} className={`border-t border-line align-top ${r.errors.length ? "bg-danger-soft" : ""}`}>
                    <td className="px-3 py-1.5 font-mono">{r.rowNumber}</td>
                    {SHOWN.map((k) => <td key={k} className="px-3 py-1.5">{r.values[k] ?? <span className="text-faint">—</span>}</td>)}
                    <td className="min-w-[14rem] px-3 py-1.5">{r.errors.length ? <ul className="space-y-0.5 text-danger">{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <span className="font-semibold text-ok">Ready</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={commitAction} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <input type="hidden" name="payload" value={pv.payload ?? ""} />
            <button disabled={!pv.validCount || committing} className="rounded-[var(--radius-control)] border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-strong disabled:opacity-50">
              {committing ? "Importing…" : `Import ${pv.validCount} asset${pv.validCount === 1 ? "" : "s"}`}
            </button>
            <span className="text-sm text-muted">{pv.errorCount ? "Rows with errors are skipped — fix them in the workbook and import them later." : "All rows are valid."}</span>
            {done?.error && <p role="alert" className="w-full text-sm text-danger">{done.error}</p>}
          </form>
        </section>
      )}
    </div>
  );
}

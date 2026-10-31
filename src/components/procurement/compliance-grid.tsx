"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/lib/procurement/forms";
import { technicalEvaluation, type ComplianceStatus } from "@/lib/procurement/scoring";
import { FormMessages, SubmitButton } from "./action-form";
import { keepInputs } from "@/lib/submit-keep";

export type ComplianceRow = {
  specItemId: number; section: string | null; parameter: string; requirement: string; unit: string | null; mandatory: boolean; weight: number;
  offeredValue: string; status: ComplianceStatus; remark: string;
};

const STATUS: { value: ComplianceStatus; label: string; on: string }[] = [
  { value: "COMPLIES", label: "Complies", on: "bg-ok-soft text-ok border-ok" },
  { value: "PARTIAL", label: "Partial", on: "bg-warn-soft text-warn border-warn" },
  { value: "NOT_COMPLIANT", label: "No", on: "bg-danger-soft text-danger border-danger" },
  { value: "NOT_STATED", label: "Not stated", on: "bg-sunken text-muted border-line" },
];
const cell = "w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[13px] focus:border-primary focus:outline-none";

/** Compact compliance entry for one offer line against its device type's specification. */
export function ComplianceGrid({ action, rows: initial, lineLabel }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>; rows: ComplianceRow[]; lineLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [rows, setRows] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const set = (id: number, patch: Partial<ComplianceRow>) => { setRows((rs) => rs.map((r) => (r.specItemId === id ? { ...r, ...patch } : r))); setDirty(true); };

  const ev = useMemo(() => technicalEvaluation(
    rows.map((r) => ({ id: r.specItemId, mandatory: r.mandatory, weight: r.weight })),
    Object.fromEntries(rows.map((r) => [r.specItemId, r.status])),
  ), [rows]);

  return (
    <form onSubmit={keepInputs(formAction, { busy: pending, before: () => setDirty(false) })}>
      <input type="hidden" name="compliance" value={JSON.stringify(rows.map((r) => ({ specItemId: r.specItemId, status: r.status, offeredValue: r.offeredValue, remark: r.remark })))} />
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>Technical score <strong className="tabular-nums">{ev.score == null ? "—" : `${ev.score.toFixed(1)}%`}</strong></span>
        <span className="text-muted">{ev.counts.COMPLIES} comply · {ev.counts.PARTIAL} partial · {ev.counts.NOT_COMPLIANT} not compliant · {ev.counts.NOT_STATED} not stated</span>
        {!ev.responsive && <span className="font-semibold text-danger">Fails {ev.mandatoryFailed.length} mandatory item{ev.mandatoryFailed.length === 1 ? "" : "s"}: technically non-responsive</span>}
        {ev.responsive && ev.mandatoryUnstated.length > 0 && <span className="text-warn">{ev.mandatoryUnstated.length} mandatory item{ev.mandatoryUnstated.length === 1 ? "" : "s"} not answered yet</span>}
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line">
        <table className="w-full min-w-[860px] border-collapse text-[13px]">
          <caption className="sr-only">Compliance of {lineLabel}</caption>
          <thead className="bg-sunken text-left text-muted">
            <tr>
              <th className="px-2 py-1.5 font-semibold">Parameter</th>
              <th className="px-2 py-1.5 font-semibold">Required</th>
              <th className="w-48 px-2 py-1.5 font-semibold">Offered</th>
              <th className="w-[17rem] px-2 py-1.5 font-semibold">Compliance</th>
              <th className="w-44 px-2 py-1.5 font-semibold">Remark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.specItemId} className={`border-t border-line align-top ${r.mandatory && r.status === "NOT_COMPLIANT" ? "bg-danger-soft" : ""}`}>
                <td className="px-2 py-1.5">
                  <span className="font-semibold">{r.parameter}</span>
                  {r.mandatory && <span className="ml-1 rounded bg-primary-soft px-1 text-[11px] font-semibold text-primary-strong" title="Mandatory">M</span>}
                  {r.section && <span className="block text-xs text-muted">{r.section} · weight {r.weight}</span>}
                </td>
                <td className="px-2 py-1.5">{r.requirement}{r.unit && !r.requirement.includes(r.unit) ? ` ${r.unit}` : ""}</td>
                <td className="px-1 py-1"><input aria-label={`Offered value for ${r.parameter}`} value={r.offeredValue} onChange={(e) => set(r.specItemId, { offeredValue: e.target.value })} className={cell} /></td>
                <td className="px-1 py-1">
                  <div role="radiogroup" aria-label={`Compliance for ${r.parameter}`} className="flex gap-1">
                    {STATUS.map((s) => (
                      <button key={s.value} type="button" role="radio" aria-checked={r.status === s.value}
                        onClick={() => set(r.specItemId, { status: s.value })}
                        className={`rounded-[var(--radius-control)] border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${r.status === s.value ? s.on : "border-line text-muted hover:bg-sunken"}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-1 py-1"><input aria-label={`Remark for ${r.parameter}`} value={r.remark} onChange={(e) => set(r.specItemId, { remark: e.target.value })} className={cell} placeholder="Datasheet p. 4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SubmitButton pending={pending}>Save compliance</SubmitButton>
        <button type="button" className="rounded-[var(--radius-control)] border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-sunken"
          onClick={() => { setRows((rs) => rs.map((r) => (r.status === "NOT_STATED" ? { ...r, status: "COMPLIES" } : r))); setDirty(true); }}>
          Mark unanswered as complies
        </button>
        {dirty && <span className="text-xs font-semibold text-warn">Unsaved changes</span>}
      </div>
      <FormMessages state={state} />
    </form>
  );
}

import Link from "next/link";
import { Badge, Field, Input, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Meter } from "@/components/assets/bits";
import { saveAssetDepreciationAction, saveTypeDepreciationAction } from "@/app/assets/depreciation-actions";
import { DEPRECIATION_STATE_LABELS, START_BASIS_LABELS } from "@/lib/assets/depreciation";
import type { BookValueRow } from "@/lib/assets/depreciation-server";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";

const TONE = { DEPRECIATING: "info", FULLY_DEPRECIATED: "warn", NOT_STARTED: "neutral", NO_COST: "neutral", NO_DATE: "neutral", NO_LIFE: "neutral" } as const;

/** Cost, depreciation so far and book value of one device (wave 27), with its own life and residual value. */
export function BookValuePanel({ bv, own, canEdit }: {
  bv: BookValueRow;
  /** The asset's own figures (empty = the device type's). */
  own: { lifeYears: number | null; residualPct: number | null };
  canEdit: boolean;
}) {
  const d = bv.dep;
  const money = (v: number | null) => formatMoney(v, bv.currency);
  const egpLine = (v: number | null) => (bv.currency !== "EGP" && v != null ? <span className="block text-xs text-muted">{formatMoney(v, "EGP")}</span> : null);
  const known = d.state === "DEPRECIATING" || d.state === "FULLY_DEPRECIATED" || d.state === "NOT_STARTED";
  return (
    <Panel title="Book value" actions={<Link href="/reports/book-value" className="text-sm text-primary hover:underline">Book value report</Link>}>
      <p className="mb-3 text-sm"><Badge tone={TONE[d.state]}>{DEPRECIATION_STATE_LABELS[d.state]}</Badge></p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div><dt className="text-xs text-muted">Cost</dt><dd>{money(d.cost)}{egpLine(bv.costEgp)}</dd></div>
        <div><dt className="text-xs text-muted">Depreciation so far</dt><dd>{known ? money(d.accumulated) : "—"}{known && egpLine(bv.accumulatedEgp)}</dd></div>
        <div><dt className="text-xs text-muted">Book value today</dt><dd className="text-lg font-semibold">{known ? money(d.bookValue) : "—"}{known && egpLine(bv.bookValueEgp)}</dd></div>
        <div><dt className="text-xs text-muted">Years left</dt><dd>{known && d.yearsLeft != null ? `${formatNumber(d.yearsLeft, 1)} of ${bv.lifeYears}` : "—"}{d.endsOn && <span className="block text-xs text-muted">written down by {formatDate(d.endsOn)}</span>}</dd></div>
      </dl>
      {known && d.pctWrittenOff != null && <div className="mt-3"><Meter pct={d.pctWrittenOff} tone={d.state === "FULLY_DEPRECIATED" ? "warn" : "primary"} label="Share of the value written off" /></div>}
      <p className="mt-3 text-xs text-muted">
        {d.state === "NO_COST" ? "Add the purchase cost to work out the book value. " : null}
        {d.state === "NO_DATE" ? "Add an install or purchase date to work out the book value. " : null}
        {d.state === "NO_LIFE" ? "Set a useful life below or on the device type. " : null}
        {bv.method === "DECLINING" ? "Double-declining balance" : "Straight line"} from the {bv.basis ? START_BASIS_LABELS[bv.basis] : "in-service date"}{bv.inService ? ` (${formatDate(bv.inService)})` : ""} over {bv.lifeYears ?? "?"} years,
        down to a residual value of {formatNumber(bv.residualPct)} %{d.residual != null ? ` (${money(d.residual)})` : ""}.
        {own.lifeYears == null && own.residualPct == null ? " Figures from the device type." : " This device has its own figures."}
      </p>
      {canEdit && (
        <details className="mt-3 border-t border-line pt-3 text-sm">
          <summary className="min-h-6 cursor-pointer font-semibold text-primary">Change life or residual value for this device</summary>
          <ActionForm action={saveAssetDepreciationAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={bv.id} />
            <Field label="Useful life (years)"><Input name="lifeYears" type="number" min={1} max={60} step={1} defaultValue={own.lifeYears ?? ""} placeholder="Type's" className="w-28" /></Field>
            <Field label="Residual value (%)"><Input name="residualPct" type="number" min={0} max={100} step="0.1" defaultValue={own.residualPct ?? ""} placeholder="Type's" className="w-28" /></Field>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

/** The device type's default life and residual value (catalogue page). */
export function TypeDepreciationForm({ typeId, lifeYears, residualPct }: { typeId: number; lifeYears: number | null; residualPct: number | null }) {
  return (
    <ActionForm action={saveTypeDepreciationAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={typeId} />
      <Field label="Useful life (years)"><Input name="lifeYears" type="number" min={1} max={60} step={1} defaultValue={lifeYears ?? ""} className="w-28" /></Field>
      <Field label="Residual value (%)"><Input name="residualPct" type="number" min={0} max={100} step="0.1" defaultValue={residualPct ?? ""} placeholder="0" className="w-28" /></Field>
      <SubmitButton variant="secondary">Save</SubmitButton>
    </ActionForm>
  );
}

import { Badge, Field, FormGrid, Input, Panel, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Sparkline } from "@/components/ui/charts";
import { Meter, NativeSelect } from "@/components/assets/bits";
import { defaultCounter, TUBE_COUNTER_LABELS, TUBE_COUNTERS, TUBE_STATE_LABELS, TUBE_STATE_TONE, tubeDays, type TubeCounter } from "@/lib/assets/tubes";
import { tubesFor, type TubeRow } from "@/lib/assets/tubes-server";
import { CURRENCIES, formatDate, formatMoney, formatNumber, todayISO } from "@/lib/format";
import { fitTubeAction, recordTubeReadingAction } from "@/app/assets/tubes/actions";

const unitOf = (t: TubeRow) => TUBE_COUNTER_LABELS[t.counterUnit as TubeCounter] ?? t.counterUnit;

function FitForm({ assetId, typeCode, current }: { assetId: number; typeCode: string; current: TubeRow | null }) {
  const today = todayISO();
  return (
    <ActionForm action={fitTubeAction} className="mt-3 space-y-3">
      <input type="hidden" name="assetId" value={assetId} />
      {current && (
        <FormGrid cols={2}>
          <Field label={`Old tube's last counter (${unitOf(current).toLowerCase()})`} hint="Optional: the reading when it came out."><Input type="number" name="oldCounter" min={0} step="any" /></Field>
          <Field label="Why it was replaced"><Input name="removedReason" maxLength={500} placeholder="e.g. arcing, end of life" /></Field>
        </FormGrid>
      )}
      <FormGrid cols={3}>
        <Field label="Serial number"><Input name="serialNumber" required maxLength={80} /></Field>
        <Field label="Maker"><Input name="maker" maxLength={80} /></Field>
        <Field label="Model"><Input name="model" maxLength={80} /></Field>
        <Field label="Fitted on"><Input type="date" name="installedOn" required defaultValue={today} max={today} /></Field>
        <Field label="Counter counts"><NativeSelect name="counterUnit" required value={current?.counterUnit ?? defaultCounter(typeCode)} options={TUBE_COUNTERS.map((c) => ({ value: c, label: TUBE_COUNTER_LABELS[c] }))} /></Field>
        <Field label="Counter when fitted" hint="0 if it resets with the tube."><Input type="number" name="counterAtInstall" min={0} step="any" defaultValue={0} /></Field>
        <Field label="Warranty (months)"><Input type="number" name="warrantyMonths" min={1} max={240} /></Field>
        <Field label="Warranty (use)" hint="In counter units, if the warranty gives one. Whichever comes first."><Input type="number" name="warrantyCounter" min={1} step="any" /></Field>
        <Field label="Expected life (use)" hint="From the maker or your past tubes."><Input type="number" name="expectedLife" min={1} step="any" /></Field>
        <Field label="Cost"><Input type="number" name="cost" min={0} step="0.01" /></Field>
        <Field label="Currency"><NativeSelect name="currency" value="EGP" options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
      </FormGrid>
      <label className="flex items-center gap-2"><input type="checkbox" name="underWarranty" /> Fitted free under the old tube&apos;s warranty</label>
      <Field label="Notes"><Textarea name="notes" rows={2} maxLength={2000} /></Field>
      <SubmitButton>{current ? "Replace the tube" : "Record the tube"}</SubmitButton>
    </ActionForm>
  );
}

/** X-ray tube of a CT or X-ray device (wave 38): the tube in use, its forecast and readings, and the replacement history. */
export async function TubePanel({ assetId, typeCode, canRecord, canEdit, disposed }: { assetId: number; typeCode: string; canRecord: boolean; canEdit: boolean; disposed: boolean }) {
  const today = todayISO();
  const tubes = await tubesFor(assetId, today);
  const cur = tubes.find((t) => !t.removedOn) ?? null;
  const past = tubes.filter((t) => t.removedOn);
  const f = cur?.forecast;
  return (
    <Panel title={<span id="tubes">X-ray tube</span>} padded={false}>
      {!cur ? <p className="px-5 py-3 text-sm text-muted">No tube in use on record. Record the tube fitted now, with its warranty, to forecast its replacement.</p> : (
        <div className="space-y-3 px-5 py-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <b>{cur.serialNumber}</b>{cur.maker || cur.model ? <span className="text-muted">{[cur.maker, cur.model].filter(Boolean).join(" ")}</span> : null}
            <Badge tone={TUBE_STATE_TONE[f!.state]}>{TUBE_STATE_LABELS[f!.state]}</Badge>
            <span className="text-muted">fitted {formatDate(cur.installedOn)} ({formatNumber(tubeDays(cur, today))} days)</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><p className="text-xs text-muted">Used ({unitOf(cur).toLowerCase()})</p><p className="font-semibold">{formatNumber(f!.used)}{cur.expectedLife ? ` of ${formatNumber(cur.expectedLife)}` : ""}</p>
              {f!.lifeUsed != null && <Meter pct={f!.lifeUsed * 100} tone={f!.lifeUsed >= 1 ? "danger" : f!.lifeUsed > 0.85 ? "warn" : "primary"} label="Share of expected life used" />}
              {f!.perDay != null && <p className="text-xs text-muted">{formatNumber(f!.perDay)} a day</p>}</div>
            <div><p className="text-xs text-muted">Forecast replacement</p><p className="font-semibold">{f!.replaceBy ? `about ${formatDate(f!.replaceBy)}` : "—"}</p>
              <p className="text-xs text-muted">{cur.expectedLife ? (f!.perDay ? "At the rate of use since fitting (last 180 days)." : "Needs two readings a day apart.") : "Enter the expected life to forecast."}</p></div>
            <div><p className="text-xs text-muted">Warranty</p><p className="font-semibold">{f!.warrantyEnd ? `${f!.outOfWarranty ? "ended" : "until"} ${formatDate(f!.warrantyEnd)}` : f!.outOfWarranty ? "ended" : "—"}</p>
              <p className="text-xs text-muted">{[cur.warrantyMonths && `${cur.warrantyMonths} months`, cur.warrantyCounter && `${formatNumber(cur.warrantyCounter)} ${unitOf(cur).toLowerCase()}`].filter(Boolean).join(" or ")}{f!.warrantyBy === "counter" && !f!.outOfWarranty ? " (forecast by use)" : ""}</p></div>
          </div>
          {cur.readings.length > 1 && <Sparkline values={cur.readings.map((r) => r.counter)} label={`Tube counter, ${unitOf(cur).toLowerCase()}`} width={200} />}
          {cur.readings.length > 0 && (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tube counter readings"><table className="w-full text-[13px]">
              <thead className="text-left text-muted"><tr><th className="py-1 pr-3 font-semibold">Date</th><th className="py-1 pr-3 text-right font-semibold">Counter</th><th className="py-1 pr-3 font-semibold">By</th><th className="py-1 font-semibold">Note</th></tr></thead>
              <tbody>{[...cur.readings].reverse().slice(0, 8).map((r) => (
                <tr key={r.id} className="border-t border-line"><td className="py-1 pr-3">{formatDate(r.readOn)}</td><td className="py-1 pr-3 text-right tabular-nums">{formatNumber(r.counter)}</td><td className="py-1 pr-3">{r.readByName ?? ""}</td><td className="py-1 text-muted">{r.note ?? ""}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
      {cur && canRecord && !disposed && (
        <details className="border-t border-line px-5 py-3 text-sm" open={!cur.readings.length}>
          <summary className="cursor-pointer text-primary">Record a counter reading</summary>
          <ActionForm action={recordTubeReadingAction} className="mt-3 space-y-3">
            <input type="hidden" name="tubeId" value={cur.id} />
            <FormGrid cols={3}>
              <Field label="Date"><Input type="date" name="readOn" required defaultValue={today} max={today} /></Field>
              <Field label={`Counter (${unitOf(cur).toLowerCase()})`} hint="As shown on the service screen."><Input type="number" name="counter" required min={0} step="any" /></Field>
              <Field label="Note"><Input name="note" maxLength={500} /></Field>
            </FormGrid>
            <SubmitButton variant="secondary">Save reading</SubmitButton>
          </ActionForm>
        </details>
      )}
      {canEdit && !disposed && (
        <details className="border-t border-line px-5 py-3 text-sm" open={!cur}>
          <summary className="cursor-pointer text-primary">{cur ? "Replace the tube" : "Record the tube in use"}</summary>
          <FitForm assetId={assetId} typeCode={typeCode} current={cur} />
        </details>
      )}
      {past.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-1 text-xs font-semibold text-muted">Replacement history</p>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Replacement history"><table className="w-full text-[13px]">
            <thead className="text-left text-muted"><tr>{["Tube", "Fitted", "Removed", "Days", "Used", "Cost", "Why"].map((h) => <th key={h} className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{past.map((t) => (
              <tr key={t.id} className="border-t border-line align-top">
                <td className="py-1 pr-3">{t.serialNumber}<div className="text-xs text-muted">{[t.maker, t.model].filter(Boolean).join(" ")}</div></td>
                <td className="py-1 pr-3">{formatDate(t.installedOn)}</td><td className="py-1 pr-3">{formatDate(t.removedOn)}</td>
                <td className="py-1 pr-3 tabular-nums">{formatNumber(tubeDays(t, today))}</td>
                <td className="py-1 pr-3 tabular-nums">{t.forecast.lastReading ? `${formatNumber(t.forecast.used)} ${unitOf(t).toLowerCase()}` : "—"}</td>
                <td className="py-1 pr-3">{t.underWarranty ? "Under warranty" : t.cost != null ? formatMoney(t.cost, t.currency ?? "EGP") : "—"}</td>
                <td className="py-1 text-muted">{t.removedReason ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="mt-1 text-xs text-muted">The cost shown on each row is what that tube cost when it was fitted.</p>
        </div>
      )}
    </Panel>
  );
}

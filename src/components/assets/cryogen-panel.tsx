import Link from "next/link";
import { Badge, Field, FormGrid, Input, Panel, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Sparkline } from "@/components/ui/charts";
import { NativeSelect } from "@/components/assets/bits";
import { CRYO_WARNING_LABELS, RUN_LABELS, type CryoStatus } from "@/lib/assets/cryogen";
import { mriMagnetRows, type MagnetRow } from "@/lib/assets/cryogen-server";
import { formatDate, formatNumber, todayISO } from "@/lib/format";
import { recordCryoReadingAction, saveMagnetSettingsAction } from "@/app/assets/cryogen/actions";

const runOptions = (list: string[]) => list.map((s) => ({ value: s, label: RUN_LABELS[s] }));

/** The state of a magnet in one line of badges. */
export function CryoBadges({ s, cryogenic }: { s: CryoStatus; cryogenic: boolean }) {
  if (!cryogenic) return <Badge>No helium (permanent magnet)</Badge>;
  if (!s.warnings.length) return <Badge tone="ok">In range</Badge>;
  return <span className="flex flex-wrap gap-1">{s.warnings.map((w) => <Badge key={w.kind} tone={w.kind === "missing" ? "warn" : "danger"}>{CRYO_WARNING_LABELS[w.kind]}</Badge>)}</span>;
}

/** Form to record one reading; with `magnets`, a scanner picker. */
export function CryoReadingForm({ assetId, magnets }: { assetId?: number; magnets?: { id: number; tag: string; typeName: string }[] }) {
  const today = todayISO();
  return (
    <ActionForm action={recordCryoReadingAction} className="space-y-3">
      {assetId ? <input type="hidden" name="assetId" value={assetId} /> : (
        <Field label="MRI scanner"><NativeSelect name="assetId" required placeholder="Choose…" options={(magnets ?? []).map((m) => ({ value: m.id, label: `${m.tag} — ${m.typeName}` }))} /></Field>
      )}
      <FormGrid cols={3}>
        <Field label="Date"><Input type="date" name="readOn" required defaultValue={today} max={today} /></Field>
        <Field label="Helium level (%)"><Input type="number" name="heliumPct" required min={0} max={100} step="0.1" /></Field>
        <Field label="Pressure (psi)"><Input type="number" name="pressurePsi" min={-15} max={100} step="0.01" /></Field>
        <Field label="Cold head"><NativeSelect name="coldHead" placeholder="Not checked" options={runOptions(["RUNNING", "STOPPED"])} /></Field>
        <Field label="Compressor"><NativeSelect name="compressor" placeholder="Not checked" options={runOptions(["RUNNING", "STOPPED", "FAULT"])} /></Field>
        <Field label="Chiller water (°C)"><Input type="number" name="chillerTempC" min={-20} max={60} step="0.1" /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Read by" hint="Blank: you."><Input name="readBy" maxLength={120} /></Field>
        <Field label="Remarks"><Textarea name="remarks" rows={1} maxLength={1000} /></Field>
      </FormGrid>
      <SubmitButton>Save reading</SubmitButton>
    </ActionForm>
  );
}

function ReadingsTable({ m }: { m: MagnetRow }) {
  const rows = [...m.readings].reverse().slice(0, 10);
  if (!rows.length) return <p className="px-5 py-3 text-sm text-muted">No reading recorded yet.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Helium readings"><table className="w-full text-[13px]">
      <thead className="bg-sunken text-left text-muted"><tr>{["Date", "Helium", "Pressure", "Cold head", "Compressor", "Chiller", "By", "Remarks"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className="border-t border-line align-top">
          <td className="whitespace-nowrap px-3 py-1.5">{formatDate(r.readOn)}</td>
          <td className={`whitespace-nowrap px-3 py-1.5 font-semibold ${r.heliumPct < m.settings.heliumMinPct ? "text-danger" : ""}`}>{formatNumber(r.heliumPct, 1)} %</td>
          <td className="whitespace-nowrap px-3 py-1.5">{r.pressurePsi != null ? `${formatNumber(r.pressurePsi, 2)} psi` : "—"}</td>
          <td className={`px-3 py-1.5 ${r.coldHead === "STOPPED" ? "font-semibold text-danger" : ""}`}>{r.coldHead ? RUN_LABELS[r.coldHead] : "—"}</td>
          <td className={`px-3 py-1.5 ${r.compressor && r.compressor !== "RUNNING" ? "font-semibold text-danger" : ""}`}>{r.compressor ? RUN_LABELS[r.compressor] : "—"}</td>
          <td className="whitespace-nowrap px-3 py-1.5">{r.chillerTempC != null ? `${formatNumber(r.chillerTempC, 1)} °C` : "—"}</td>
          <td className="px-3 py-1.5">{r.readBy}</td><td className="min-w-48 px-3 py-1.5 text-muted">{r.remarks ?? ""}</td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

/** Helium log of one MRI scanner (wave 38), on its asset page. Server component. */
export async function CryogenPanel({ assetId, canRecord, canEdit, disposed }: { assetId: number; canRecord: boolean; canEdit: boolean; disposed: boolean }) {
  const [m] = await mriMagnetRows({ scope: null, assetIds: [assetId] }, todayISO());
  if (!m) return null;
  const s = m.status, st = m.settings;
  return (
    <Panel title={<span id="cryogen">Helium and cryogen log</span>} padded={false}
      actions={<Link href={`/assets/cryogen?facilityId=${m.facilityId}`} className="text-sm text-primary hover:underline">All MRI scanners</Link>}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
        <CryoBadges s={s} cryogenic={st.cryogenic} />
        {st.cryogenic && s.latest && <span><b className="text-lg">{formatNumber(s.latest.heliumPct, 1)} %</b> <span className="text-muted">on {formatDate(s.latest.readOn)}</span></span>}
        {st.cryogenic && <Sparkline values={m.readings.map((r) => r.heliumPct)} label="Helium level %" tone={s.warnings.some((w) => w.kind !== "missing") ? "danger" : "primary"} />}
        {st.cryogenic && s.ratePer30 != null && <span className="text-muted">{s.ratePer30 > 0 ? `Falling ${formatNumber(s.ratePer30, 2)} points a month` : "Not falling"}{s.reachesMinOn ? ` · reaches ${st.heliumMinPct} % about ${formatDate(s.reachesMinOn)}` : ""}</span>}
      </div>
      {s.warnings.length > 0 && <ul className="mx-5 mb-3 space-y-1 rounded-[var(--radius-control)] border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{s.warnings.map((w) => <li key={w.kind}>{w.text}</li>)}</ul>}
      {st.cryogenic && <p className="px-5 pb-2 text-xs text-muted">Warns below {st.heliumMinPct} %, on a fall of more than {st.maxDropPct} points in {st.dropWindowDays} days (from the last refill), and after {st.maxGapDays} days without a reading{m.ownSettings ? "" : " (defaults)"}.</p>}
      {st.cryogenic && <ReadingsTable m={m} />}
      {st.cryogenic && canRecord && !disposed && (
        <details className="border-t border-line px-5 py-3 text-sm" open={!m.readings.length}>
          <summary className="cursor-pointer text-primary">Record a reading</summary>
          <div className="mt-3"><CryoReadingForm assetId={assetId} /></div>
        </details>
      )}
      {canEdit && !disposed && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer text-primary">Change the warning levels</summary>
          <ActionForm action={saveMagnetSettingsAction} className="mt-3 space-y-3">
            <input type="hidden" name="assetId" value={assetId} />
            <label className="flex items-center gap-2"><input type="checkbox" name="cryogenic" defaultChecked={st.cryogenic} /> Superconducting magnet with liquid helium</label>
            <FormGrid cols={2}>
              <Field label="Minimum helium (%)" hint="Book a refill below this."><Input type="number" name="heliumMinPct" required min={0} max={100} step="0.5" defaultValue={st.heliumMinPct} /></Field>
              <Field label="A reading at least every (days)"><Input type="number" name="maxGapDays" required min={1} max={90} defaultValue={st.maxGapDays} /></Field>
              <Field label="Largest allowed fall (points)"><Input type="number" name="maxDropPct" required min={0.1} max={100} step="0.1" defaultValue={st.maxDropPct} /></Field>
              <Field label="In (days)"><Input type="number" name="dropWindowDays" required min={1} max={365} defaultValue={st.dropWindowDays} /></Field>
            </FormGrid>
            <SubmitButton variant="secondary">Save warning levels</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

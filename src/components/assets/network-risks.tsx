import { Badge, Field, FormGrid, Input, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { saveNetworkRiskAction } from "@/app/assets/security/risk-actions";
import { LEVEL_LABELS, LIKELIHOOD, RISK_STATUS_LABELS, RISK_STATUSES, riskLevel, riskScore, SEVERITY } from "@/lib/assets/network-risk";
import { formatDate } from "@/lib/format";

type Risk = {
  id: number; connectsTo: string; dataExchanged: string | null; hazard: string; likelihood: number; severity: number; controls: string | null;
  residualLikelihood: number; residualSeverity: number; owner: string | null; reviewDue: string | null; status: string;
};
const TONE = { low: "ok", medium: "warn", high: "danger" } as const;
const scale = (labels: readonly string[]) => labels.map((l, i) => ({ value: String(i + 1), label: `${i + 1} · ${l}` }));

function RiskForm({ assetId, r }: { assetId: number; r?: Risk }) {
  return (
    <ActionForm action={saveNetworkRiskAction} className="mt-3 space-y-3">
      <input type="hidden" name="assetId" value={assetId} />
      {r && <input type="hidden" name="riskId" value={r.id} />}
      <FormGrid cols={3}>
        <Field label="Connects to" hint="The other system, e.g. PACS, HIS, the supplier's remote service"><Input name="connectsTo" required defaultValue={r?.connectsTo ?? ""} /></Field>
        <Field label="Data exchanged"><Input name="dataExchanged" defaultValue={r?.dataExchanged ?? ""} placeholder="Images and patient ID (DICOM)" /></Field>
        <Field label="Owner" hint="Who keeps this risk under review"><Input name="owner" defaultValue={r?.owner ?? ""} /></Field>
        <Field label="Hazard" className="sm:col-span-2 lg:col-span-3" hint="What could go wrong for patients, data or the service"><Input name="hazard" required defaultValue={r?.hazard ?? ""} /></Field>
        <Field label="Likelihood"><Select name="likelihood" defaultValue={String(r?.likelihood ?? 3)} options={scale(LIKELIHOOD)} /></Field>
        <Field label="Severity"><Select name="severity" defaultValue={String(r?.severity ?? 3)} options={scale(SEVERITY)} /></Field>
        <Field label="Review by"><Input type="date" name="reviewDue" defaultValue={r?.reviewDue ?? ""} /></Field>
        <Field label="Controls" className="sm:col-span-2 lg:col-span-3" hint="What lowers the risk: separate network, firewall rule, encryption, supervised remote sessions…"><Input name="controls" defaultValue={r?.controls ?? ""} /></Field>
        <Field label="Likelihood after controls"><Select name="residualLikelihood" defaultValue={String(r?.residualLikelihood ?? 2)} options={scale(LIKELIHOOD)} /></Field>
        <Field label="Severity after controls"><Select name="residualSeverity" defaultValue={String(r?.residualSeverity ?? 3)} options={scale(SEVERITY)} /></Field>
        <Field label="Status"><Select name="status" defaultValue={r?.status ?? "OPEN"} options={RISK_STATUSES.map((s) => ({ value: s, label: RISK_STATUS_LABELS[s] }))} /></Field>
      </FormGrid>
      <SubmitButton>{r ? "Save risk" : "Add risk"}</SubmitButton>
    </ActionForm>
  );
}

/** Network risk per connection of one device (wave 41, IEC 80001-1:2021). Server component inside the security panel. */
export function NetworkRisks({ assetId, risks, canEdit, today }: { assetId: number; risks: Risk[]; canEdit: boolean; today: string }) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-2 text-sm font-semibold">Connections and risks</h3>
      {risks.length === 0 ? <p className="text-sm text-muted">No connection assessed yet. Add one entry per system this device talks to.</p> : (
        <ul className="divide-y divide-line text-sm">
          {risks.map((r) => {
            const before = riskLevel(riskScore(r.likelihood, r.severity)), after = riskLevel(riskScore(r.residualLikelihood, r.residualSeverity));
            return (
              <li key={r.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{r.connectsTo}</b>
                  <Badge tone={TONE[before]}>{LEVEL_LABELS[before]} before</Badge>
                  <Badge tone={TONE[after]}>{LEVEL_LABELS[after]} after controls</Badge>
                  {r.status !== "OPEN" && <Badge tone="neutral">{RISK_STATUS_LABELS[r.status as keyof typeof RISK_STATUS_LABELS] ?? r.status}</Badge>}
                </div>
                <p className="text-muted">{r.hazard}{r.dataExchanged ? ` · ${r.dataExchanged}` : ""}</p>
                {r.controls && <p className="text-xs">Controls: {r.controls}</p>}
                <p className={`text-xs ${r.status !== "CLOSED" && r.reviewDue && r.reviewDue < today ? "font-semibold text-danger" : "text-muted"}`}>
                  {r.owner ? `Owner ${r.owner}` : "No owner"}{r.reviewDue ? ` · review by ${formatDate(r.reviewDue)}` : ""}</p>
                {canEdit && <details><summary className="cursor-pointer text-xs font-semibold text-primary">Edit</summary><RiskForm assetId={assetId} r={r} /></details>}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-primary">Add a connection risk</summary><RiskForm assetId={assetId} /></details>}
    </div>
  );
}

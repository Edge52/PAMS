/** Delivery, installation and acceptance of a device (wave 10). Server component. */
import Link from "next/link";
import { Badge, Button, Field, Input, Panel, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { isMeasurement, rangeLabel } from "@/lib/assets/checklists";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { acceptanceSheet } from "@/lib/procurement/acceptance-server";
import { saveAcceptanceAction } from "@/app/assets/acceptance-actions";

export async function AcceptancePanel({ assetId, status, me }: { assetId: number; status: string; me: CurrentUser }) {
  const s = await acceptanceSheet(assetId);
  if (!s) return null;
  const r = s.record;
  if (!r && !s.po && status !== "IN_STOCK" && status !== "INSTALLED") return null;
  const biomed = can(me.role, "assets.edit"), dept = me.role === "DEPARTMENT_HEAD" || biomed;
  const done = r?.status === "ACCEPTED";
  const tone = done ? "ok" : r?.status === "REJECTED" ? "danger" : "warn";
  return (
    <Panel title={<span id="acceptance">Delivery and acceptance</span>} actions={<Badge tone={tone}>{done ? `Accepted ${formatDate(r!.acceptedOn)}` : r?.status === "REJECTED" ? "Not accepted" : "Waiting"}</Badge>}>
      {s.po && <p className="mb-3 text-sm text-muted">From <Link href={`/procurement/purchase-orders/${s.po.id}`} className="text-primary hover:underline">{s.po.number}</Link>{s.po.warrantyMonths ? `: ${s.po.warrantyMonths}-month warranty from acceptance.` : "."}</p>}
      {done || !biomed ? (
        <ul className="space-y-1 text-sm">{s.sheet.map((c, i) => <li key={i} className="flex gap-2"><span className={c.result === "FAIL" ? "text-danger" : c.result === "PASS" ? "text-ok" : "text-muted"}>{c.result ?? "—"}</span><span>{c.text}{c.value != null ? ` (${c.value}${c.unit ? ` ${c.unit}` : ""})` : ""}{c.note ? <span className="text-muted"> — {c.note}</span> : null}</span></li>)}</ul>
      ) : (
        <ActionForm action={saveAcceptanceAction} className="space-y-3">
          <input type="hidden" name="assetId" value={assetId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Delivered on"><Input type="date" name="deliveredOn" defaultValue={r?.deliveredOn ?? ""} /></Field>
            <Field label="Installed on"><Input type="date" name="installedOn" defaultValue={r?.installedOn ?? ""} /></Field>
          </div>
          <ol className="space-y-2 text-sm">{s.sheet.map((c, i) => (
            <li key={i} className="rounded border border-line p-2">
              <p>{c.text}{isMeasurement(c) && <span className="text-muted"> — {c.unit ?? "reading"}{rangeLabel(c) ? `, pass ${rangeLabel(c)}` : ""}</span>}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                {(["PASS", "FAIL", "NA"] as const).map((v) => <label key={v} className="flex items-center gap-1"><input type="radio" name={`res_${i}`} value={v} defaultChecked={c.result === v} />{v === "NA" ? "N/A" : v === "PASS" ? "Pass" : "Fail"}</label>)}
                {isMeasurement(c) && <Input name={`val_${i}`} inputMode="decimal" defaultValue={c.value ?? ""} className="w-24" aria-label={`Reading for ${c.text}`} />}
                <Input name={`note_${i}`} defaultValue={c.note ?? ""} placeholder="Note" className="min-w-32 flex-1" aria-label={`Note for ${c.text}`} />
              </div>
            </li>
          ))}</ol>
          <Field label="Issues for the supplier"><Textarea name="issues" rows={2} defaultValue={r?.issues ?? ""} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button name="intent" value="save" variant="secondary">Save checks</Button>
            {!r?.biomedSignedBy && <Button name="intent" value="sign_biomed">Sign for biomedical engineering</Button>}
            <Button name="intent" value="reject" variant="ghost">Not accepted</Button>
          </div>
        </ActionForm>
      )}
      <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
        <p>Biomedical engineering: {r?.biomedSignedBy ? <b>{r.biomedSignedBy}, {formatDateTime(r.biomedSignedAt)}</b> : <span className="text-muted">not signed</span>}</p>
        <p>Department: {r?.departmentSignedBy ? <b>{r.departmentSignedBy}, {formatDateTime(r.departmentSignedAt)}</b> : <span className="text-muted">not signed</span>}</p>
        {r?.issues && <p className="text-warn">Issues: {r.issues}</p>}
        {!done && dept && r?.biomedSignedBy && !r.departmentSignedBy && (
          <ActionForm action={saveAcceptanceAction} className="flex flex-wrap items-end gap-2 pt-1">
            <input type="hidden" name="assetId" value={assetId} />
            {biomed && me.role !== "DEPARTMENT_HEAD" && <Field label="Signed for the department by"><Input name="deptName" required maxLength={120} /></Field>}
            <Button name="intent" value="sign_dept">Sign for the department</Button>
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}

/**
 * Equipment ID card on the device page (wave 40, GAHAR 2025 standards EFS.10 EOC 4): who to call when it fails —
 * the vendor's service line and contract, and the in-house contact. Server component.
 */
import Link from "next/link";
import { Field, FormGrid, Input, LinkButton, Panel } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { saveIdCardAction } from "@/app/assets/[id]/id-card/actions";
import { idCards } from "@/lib/compliance/id-card-server";
import { VENDOR_SOURCE_LABELS } from "@/lib/compliance/id-card";
import { formatDate, todayISO } from "@/lib/format";

export async function IdCardPanel({ assetId, canEdit }: { assetId: number; canEdit: boolean }) {
  const c = (await idCards([assetId], todayISO())).get(assetId);
  if (!c) return null;
  return (
    <Panel title={<span id="id-card">Equipment ID card</span>} actions={<LinkButton href={`/assets/${assetId}/id-card`} variant="ghost">Print ID card</LinkButton>}>
      <dl className="grid grid-cols-1 gap-3 text-sm">
        <div><dt className="text-xs text-muted">Vendor emergency line</dt>
          <dd>{c.vendor.phone ? <><a href={`tel:${c.vendor.phone.replace(/[^+\d]/g, "")}`} className="font-semibold text-primary hover:underline">{c.vendor.phone}</a>{c.vendor.name ? ` · ${c.vendor.name}` : ""}
            {c.vendor.source && <span className="block text-xs text-muted">{VENDOR_SOURCE_LABELS[c.vendor.source]}</span>}</> : <span className="text-warn">No vendor phone. Add a service contact to the supplier, or type it below.</span>}</dd></div>
        <div><dt className="text-xs text-muted">Service contract</dt>
          <dd>{c.contractNumber ? <><Link href={`/assets/contracts/${c.contractId}`} className="font-mono text-primary hover:underline">{c.contractNumber}</Link>{c.contractEnd ? ` to ${formatDate(c.contractEnd)}` : ""}</> : "None running"}</dd></div>
        <div><dt className="text-xs text-muted">In-house contact</dt>
          <dd>{c.inHouseName ? <>{c.inHouseName}{c.inHousePhone ? ` · ${c.inHousePhone}` : ""}</> : <span className="text-warn">Not set</span>}</dd></div>
      </dl>
      {canEdit && (
        <details className="mt-3 border-t border-line pt-3">
          <summary className="cursor-pointer text-sm font-semibold text-primary">Change contacts</summary>
          <ActionForm action={saveIdCardAction} className="mt-3 space-y-3">
            <input type="hidden" name="assetId" value={assetId} />
            <FormGrid cols={1}>
              <Field label="In-house contact" hint="Who in the hospital looks after it, e.g. the biomedical engineer on duty."><Input name="inHouseName" maxLength={200} defaultValue={c.inHouseName ?? ""} /></Field>
              <Field label="In-house phone or extension"><Input name="inHousePhone" maxLength={64} defaultValue={c.inHousePhone ?? ""} /></Field>
              <Field label="Vendor emergency phone" hint="Only when the contract and the supplier's contacts have none."><Input name="vendorPhone" maxLength={64} defaultValue={c.cardVendorPhone ?? ""} /></Field>
            </FormGrid>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="showOnLabel" defaultChecked={c.showOnLabel} /> Show the service line on the QR label</label>
            <SubmitButton>Save contacts</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Panel>
  );
}

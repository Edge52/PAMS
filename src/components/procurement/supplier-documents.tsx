import { Badge, Input, Panel, Select } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { DocumentUploadForm } from "@/components/document-upload-form";
import { saveSupplierDocumentAction } from "@/app/procurement/suppliers/documents/actions";
import { deleteDocument } from "@/lib/documents";
import { canEditDocuments, listDocuments } from "@/lib/documents-access";
import { formatDate, todayISO } from "@/lib/format";
import { DOC_STATE_LABELS, DOC_STATE_TONE, SUPPLIER_DOC_TYPES, docExpiry, docTypeLabel, expiryText } from "@/lib/procurement/supplier-docs";

const TYPES = SUPPLIER_DOC_TYPES.map((t) => ({ value: t.value, label: t.label }));

/** A supplier's licences, registrations and certificates with their expiry dates (wave 27). Server component. */
export async function SupplierDocumentsPanel({ supplierId }: { supplierId: number }) {
  const [docs, canEdit] = await Promise.all([listDocuments("supplier", supplierId), canEditDocuments("supplier")]);
  const today = todayISO();
  const rows = docs.map((d) => ({ ...d, expiry: docExpiry(d.expiresOn, today) }))
    .sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || b.id - a.id);
  const expired = rows.filter((r) => r.expiry.state === "EXPIRED").length;
  const expiring = rows.filter((r) => r.expiry.state === "EXPIRING").length;
  const returnPath = `/procurement/suppliers/${supplierId}`;
  return (
    <Panel title="Licences, registrations, certificates">
      {(expired > 0 || expiring > 0) && (
        <p role={expired ? "alert" : "status"} className={`mb-3 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${expired ? "border-danger bg-danger-soft text-danger" : "border-warn bg-warn-soft text-warn"}`}>
          {expired ? `${expired} expired` : ""}{expired && expiring ? " · " : ""}{expiring ? `${expiring} expiring within 60 days` : ""}. Ask the supplier for renewed copies.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mb-3 text-sm text-muted">{canEdit ? "No documents yet. Attach the agency letter, EDA registration, ISO 13485 certificate and licences below, with their expiry dates." : "No documents yet."}</p>
      ) : (
        <ul className="mb-4 divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-primary hover:underline">{d.fileName}</a>
                <Badge tone={DOC_STATE_TONE[d.expiry.state]}>{DOC_STATE_LABELS[d.expiry.state]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted">{docTypeLabel(d.kind)} · {expiryText(d.expiry, formatDate(d.expiresOn))} · added {formatDate(d.uploadedAt)}</p>
              {canEdit && (
                <details className="mt-1">
                  <summary className="min-h-6 cursor-pointer text-xs font-semibold text-primary">Change type or date</summary>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm action={saveSupplierDocumentAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <label className="text-xs"><span className="mb-1 block font-semibold">Type</span>
                        <Select name="kind" options={TYPES} defaultValue={TYPES.some((t) => t.value === d.kind) ? d.kind ?? "other" : "other"} className="w-auto" /></label>
                      <label className="text-xs"><span className="mb-1 block font-semibold">Valid until</span>
                        <Input type="date" name="expiresOn" defaultValue={d.expiresOn ?? ""} className="w-auto" /></label>
                      <SubmitButton variant="secondary">Save</SubmitButton>
                    </ActionForm>
                    <form action={deleteDocument}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="returnPath" value={returnPath} />
                      <button className="min-h-8 px-2 text-sm text-danger hover:underline" aria-label={`Remove ${d.fileName}`}>Remove</button>
                    </form>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <DocumentUploadForm entityType="supplier" entityId={supplierId} returnPath={returnPath} kinds={TYPES} withExpiry />}
    </Panel>
  );
}

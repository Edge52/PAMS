import { deleteDocument } from "@/lib/documents";
import { canEditDocuments, listDocuments } from "@/lib/documents-access";
import { Panel } from "@/components/ui";
import { DocumentUploadForm } from "./document-upload-form";
import { formatDate } from "@/lib/format";

const KINDS = [
  { value: "quotation", label: "Quotation" }, { value: "datasheet", label: "Datasheet" },
  { value: "compliance", label: "Compliance statement" }, { value: "certificate", label: "Certificate (CE/FDA/ISO)" },
  { value: "po_scan", label: "Signed PO" }, { value: "delivery_note", label: "Delivery note" },
  { value: "invoice", label: "Invoice" }, { value: "manual", label: "Manual" }, { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Server component: lists attachments and offers an upload form. */
export async function DocumentsPanel({ entityType, entityId, returnPath, title = "Documents" }: {
  entityType: string; entityId: number; returnPath: string; title?: string;
}) {
  const [docs, canEdit] = await Promise.all([listDocuments(entityType, entityId), canEditDocuments(entityType)]);
  return (
    <Panel title={title}>
      {docs.length === 0 ? (
        <p className="mb-3 text-sm text-muted">{canEdit ? "No files attached yet. Attach the quotation, datasheets or certificates below." : "No files attached yet."}</p>
      ) : (
        <ul className="mb-4 divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-primary hover:underline">{d.fileName}</a>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                <span>{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</span>
                <span>{size(d.sizeBytes)}</span>
                <span>{formatDate(d.uploadedAt)}</span>
                {canEdit && <form action={deleteDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <button className="text-danger hover:underline" aria-label={`Remove ${d.fileName}`}>Remove</button>
                </form>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && <DocumentUploadForm entityType={entityType} entityId={entityId} returnPath={returnPath} kinds={KINDS} />}
    </Panel>
  );
}

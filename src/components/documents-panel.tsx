import { deleteDocument } from "@/lib/documents";
import { canEditDocuments, listDocuments, listVersions } from "@/lib/documents-access";
import { fileSize } from "@/lib/document-versions";
import { DocumentVersions } from "./document-versions";
import { Panel } from "@/components/ui";
import { DocumentUploadForm } from "./document-upload-form";
import { formatDate } from "@/lib/format";
import { ConfirmButton } from "@/components/ui/confirm";

const KINDS = [
  { value: "quotation", label: "Quotation" }, { value: "datasheet", label: "Datasheet" },
  { value: "compliance", label: "Compliance statement" }, { value: "certificate", label: "Certificate (CE/FDA/ISO)" },
  { value: "po_scan", label: "Signed PO" }, { value: "delivery_note", label: "Delivery note" },
  { value: "invoice", label: "Invoice" }, { value: "manual", label: "Manual" }, { value: "photo", label: "Photo" },
  { value: "service_report", label: "Service report" }, { value: "sign_in_sheet", label: "Sign-in sheet" },
  { value: "calibration_certificate", label: "Calibration certificate" }, { value: "licence", label: "Licence" },
  { value: "sbom", label: "Software bill of materials (SBOM)" }, { value: "remote_access_agreement", label: "Remote-access agreement" },
  { value: "other", label: "Other" },
];
const byValue = (vs: string[]) => vs.map((v) => KINDS.find((k) => k.value === v)!).filter(Boolean);

/** Server component: lists attachments and offers an upload form. */
export async function DocumentsPanel({ entityType, entityId, returnPath, title = "Documents", kinds, emptyHint, withExpiry = false }: {
  entityType: string; entityId: number; returnPath: string; title?: string;
  /** Document kinds offered on upload, first one preselected (default: every kind, quotation first). */
  kinds?: string[];
  /** What to attach, shown when nothing is attached yet. */
  emptyHint?: string;
  /** Ask for a "valid until" date on upload and show it (wave 41). */
  withExpiry?: boolean;
}) {
  const offered = kinds ? byValue(kinds) : KINDS;
  const [docs, canEdit] = await Promise.all([listDocuments(entityType, entityId), canEditDocuments(entityType)]);
  const versions = await listVersions(docs.map((d) => d.id));
  return (
    <Panel title={title}>
      {docs.length === 0 ? (
        <p className="mb-3 text-sm text-muted">{canEdit ? `No files attached yet. ${emptyHint ?? "Attach the quotation, datasheets or certificates below."}` : "No files attached yet."}</p>
      ) : (
        <ul className="mb-4 divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
              <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-primary hover:underline">{d.fileName}</a>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                <span>{KINDS.find((k) => k.value === d.kind)?.label ?? d.kind}</span>
                {d.version > 1 && <span>v{d.version}</span>}
                {withExpiry && d.expiresOn && <span>valid until {formatDate(d.expiresOn)}</span>}
                <span>{fileSize(d.sizeBytes)}</span>
                <span>{formatDate(d.uploadedAt)}{d.uploadedByName ? ` · ${d.uploadedByName}` : ""}</span>
                {canEdit && <form action={deleteDocument}>
                  <input type="hidden" name="id" value={d.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <ConfirmButton confirm={`Remove ${d.fileName} from this record? An administrator can restore it.`} className="text-danger hover:underline" aria-label={`Remove ${d.fileName}`}>Remove</ConfirmButton>
                </form>}
              </span>
              </div>
              {d.note && <p className="text-xs text-muted">{d.note}</p>}
              <DocumentVersions doc={d} earlier={versions.filter((v) => v.documentId === d.id)} canEdit={canEdit} returnPath={returnPath} />
            </li>
          ))}
        </ul>
      )}
      {canEdit && <DocumentUploadForm entityType={entityType} entityId={entityId} returnPath={returnPath} kinds={offered} withExpiry={withExpiry} />}
    </Panel>
  );
}

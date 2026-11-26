/** Wave 39: a document's earlier files and the form for a new version. Server component, used by the documents panels. */
import { DocumentUploadForm } from "./document-upload-form";
import { formatDateTime } from "@/lib/format";
import { fileSize, versionHistory, type VersionRow } from "@/lib/document-versions";

type Doc = { id: number; entityType: string; entityId: number; fileName: string; url: string; sizeBytes: number | null; uploadedAt: Date; uploadedByName: string | null; note: string | null; version: number };

export function DocumentVersions({ doc, earlier, canEdit, returnPath, withExpiry = false }: {
  doc: Doc; earlier: VersionRow[]; canEdit: boolean; returnPath: string; withExpiry?: boolean;
}) {
  const history = versionHistory(doc, earlier);
  if (history.length < 2 && !canEdit) return null;
  return (
    <details className="mt-1">
      <summary className="min-h-6 cursor-pointer text-xs font-semibold text-primary">{history.length > 1 ? `Versions (${history.length})` : "Upload a new version"}</summary>
      {history.length > 1 && (
        <ol className="mt-1 space-y-1 text-xs">
          {history.map((v) => (
            <li key={v.version} className="flex flex-wrap gap-x-2">
              <a href={v.url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">{v.label}</a>
              <span className="text-muted">{v.fileName} · {fileSize(v.sizeBytes)} · {formatDateTime(v.uploadedAt)}{v.uploadedByName ? ` by ${v.uploadedByName}` : ""}</span>
              {v.note && <span>“{v.note}”</span>}
            </li>
          ))}
        </ol>
      )}
      {canEdit && <div className="mt-2"><DocumentUploadForm entityType={doc.entityType} entityId={doc.entityId} returnPath={returnPath} kinds={[]} documentId={doc.id} fileName={doc.fileName} withExpiry={withExpiry} /></div>}
    </details>
  );
}

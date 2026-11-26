"use client";

import { useActionState, useRef, useEffect } from "react";
import { uploadDocument, type UploadState } from "@/lib/documents";
import { Button, Input, Select } from "@/components/ui";

export function DocumentUploadForm({ entityType, entityId, returnPath, kinds, withExpiry = false, documentId, fileName }: {
  entityType: string; entityId: number; returnPath: string; kinds: { value: string; label: string }[];
  /** Wave 27: ask for an expiry date (supplier licences, registrations and certificates). */
  withExpiry?: boolean;
  /** Wave 39: upload a new version of this document (the old file is kept); no type picker. */
  documentId?: number; fileName?: string;
}) {
  const asVersion = documentId != null;
  const idBase = `${entityType}-${entityId}${asVersion ? `-v${documentId}` : ""}`;
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadDocument, null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.ok && fileRef.current) fileRef.current.value = ""; }, [state]);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="returnPath" value={returnPath} />
        {asVersion && <input type="hidden" name="documentId" value={documentId} />}
        <input ref={fileRef} type="file" name="file" required aria-label={asVersion ? `New version of ${fileName ?? "this document"}` : "File to attach"}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.dwg,.dxf,.msg,.eml"
          className="max-w-full text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" />
        {!asVersion && <Select name="kind" options={kinds} defaultValue={kinds[0]?.value} className="w-auto" aria-label="Document type" />}
        {withExpiry && <label className="flex items-center gap-1.5 text-sm"><span>Valid until</span><Input type="date" name="expiresOn" className="w-auto" aria-describedby={`exp-hint-${idBase}`} /></label>}
        <Input name="note" maxLength={500} placeholder={asVersion ? "What changed (optional)" : "Note (optional)"} aria-label={asVersion ? "What changed" : "Note"} className="w-auto min-w-40 flex-1" />
        <Button variant="secondary" disabled={pending}>{pending ? (asVersion ? "Uploading…" : "Attaching…") : (asVersion ? "Upload new version" : "Attach file")}</Button>
      </div>
      {withExpiry && <p id={`exp-hint-${idBase}`} className="text-xs text-muted">{asVersion ? "Leave the date empty to keep the current one." : "Leave the date empty when the document has no expiry."}</p>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}

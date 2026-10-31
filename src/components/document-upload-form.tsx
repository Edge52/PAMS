"use client";

import { useActionState, useRef, useEffect } from "react";
import { uploadDocument, type UploadState } from "@/lib/documents";
import { Button, Select } from "@/components/ui";

export function DocumentUploadForm({ entityType, entityId, returnPath, kinds }: {
  entityType: string; entityId: number; returnPath: string; kinds: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadDocument, null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (state?.ok && fileRef.current) fileRef.current.value = ""; }, [state]);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="entityType" value={entityType} />
        <input type="hidden" name="entityId" value={entityId} />
        <input type="hidden" name="returnPath" value={returnPath} />
        <input ref={fileRef} type="file" name="file" required aria-label="File to attach"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.dwg,.dxf,.msg,.eml"
          className="max-w-full text-sm file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-2 file:py-1" />
        <Select name="kind" options={kinds} defaultValue="quotation" className="w-auto" aria-label="Document type" />
        <Button variant="secondary" disabled={pending}>{pending ? "Attaching…" : "Attach file"}</Button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  );
}

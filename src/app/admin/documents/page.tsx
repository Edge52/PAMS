import Link from "next/link";
import { EmptyState, PageHeader, Table, THead, Th, Td } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm";
import { requirePermission } from "@/lib/auth/session";
import { purgeDocument, restoreDocument } from "@/lib/documents";
import { listDeletedDocuments } from "@/lib/documents-access";
import { RECORD_LABELS, fileSize, recordHref, removedLine } from "@/lib/document-versions";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deleted documents" };

/** Wave 39: documents people removed. Their files are kept until an administrator deletes them for good. */
export default async function DeletedDocumentsPage() {
  await requirePermission("settings.manage");
  const rows = await listDeletedDocuments();
  return (
    <>
      <PageHeader title="Deleted documents" description="Files removed from records. They are hidden from everyone else and their files are kept. Restore one to put it back on its record, or delete it for good." />
      {rows.length === 0 ? <EmptyState title="No deleted documents">When someone removes a file from a record, it shows here.</EmptyState> : (
        <Table>
          <THead><tr><Th>File</Th><Th>Record</Th><Th>Removed</Th><Th>Versions</Th><Th><span className="sr-only">Actions</span></Th></tr></THead>
          <tbody>{rows.map((d) => {
            const href = recordHref(d.entityType, d.entityId);
            const label = `${RECORD_LABELS[d.entityType] ?? d.entityType} ${d.entityId}`;
            return (
              <tr key={d.id} className="border-t border-line align-top">
                <Td><a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">{d.fileName}</a><span className="block text-xs text-muted">{fileSize(d.sizeBytes)}</span></Td>
                <Td>{href ? <Link href={href} className="text-primary hover:underline">{label}</Link> : label}</Td>
                <Td>{removedLine(d.deletedAt, d.deletedByName, formatDateTime)}</Td>
                <Td>{d.version}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <form action={restoreDocument}><input type="hidden" name="id" value={d.id} /><button className="min-h-8 px-2 text-sm font-semibold text-primary hover:underline">Restore</button></form>
                    <form action={purgeDocument}><input type="hidden" name="id" value={d.id} />
                      <ConfirmButton confirm={`Delete ${d.fileName} for good, with all its versions? The files are removed from storage and this can't be undone.`} tone="danger" confirmLabel="Delete for good"
                        className="min-h-8 px-2 text-sm text-danger hover:underline" aria-label={`Delete ${d.fileName} for good`}>Delete for good</ConfirmButton>
                    </form>
                  </div>
                </Td>
              </tr>
            );
          })}</tbody>
        </Table>
      )}
    </>
  );
}

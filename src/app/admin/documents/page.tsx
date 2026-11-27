import Link from "next/link";
import { and, desc, eq, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { documents, users } from "@/db/schema";
import { Button, EmptyState, Input, PageHeader, TabLinks } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { BulkHidden } from "@/components/bulk-fields";
import { NativeSelect, Notice } from "@/components/assets/bits";
import { requirePermission } from "@/lib/auth/session";
import { purgeDocument, restoreDocument } from "@/lib/documents";
import { ENTITY_TYPES } from "@/lib/documents-access";
import { RECORD_LABELS, fileSize, recordHref, removedLine } from "@/lib/document-versions";
import { formatDateTime } from "@/lib/format";
import { PAGE_SIZE, pageFor, pageHref, sqlOrder } from "@/lib/paging";
import { bulkRemoveDocumentsAction, bulkRestoreDocumentsAction } from "./bulk-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const SORT_KEYS = ["file", "record", "when", "version"] as const;
const person = alias(users, "person");

/**
 * Every attached document (wave 41), and the ones people removed (wave 39). Removed files are kept until an
 * administrator deletes them for good. Tick documents to remove or restore several at once.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const tab = one(sp.tab) === "deleted" ? "deleted" : "all";
  const q = one(sp.q);
  const type = ENTITY_TYPES.find((t) => t === one(sp.type));
  const sort = tableSort(sp, SORT_KEYS);
  const removed = tab === "deleted";
  const where = and(removed ? isNotNull(documents.deletedAt) : isNull(documents.deletedAt),
    q ? ilike(documents.fileName, `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined, type ? eq(documents.entityType, type) : undefined);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(where);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const when = removed ? documents.deletedAt : documents.uploadedAt;
  const rows = (await db.select({ d: documents, by: person.name }).from(documents)
    .leftJoin(person, eq(person.id, removed ? documents.deletedById : documents.uploadedById)).where(where)
    .orderBy(...sqlOrder(sort, { file: documents.fileName, record: documents.entityType, when, version: documents.version }, [desc(when)], [desc(documents.id)]))
    .limit(paging.size).offset(paging.offset)).map((r) => ({ ...r.d, by: r.by }));
  const path = "/admin/documents";
  const here = pageHref(path, sp, paging.page);
  const tabHref = (t: string) => `${path}${t === "deleted" ? "?tab=deleted" : ""}`;

  return (
    <>
      <PageHeader title="Documents" description="Files attached to records. Removed files are hidden from everyone else and kept: restore one to put it back on its record, or delete it for good." />
      <Notice sp={sp} />
      <TabLinks active={tab} tabs={[{ key: "all", label: "In use", href: tabHref("all") }, { key: "deleted", label: "Removed", href: tabHref("deleted") }]} />
      <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
        {removed && <input type="hidden" name="tab" value="deleted" />}
        <label className="min-w-0 flex-1 basis-52"><span className="sr-only">File name</span><Input type="search" name="q" defaultValue={q ?? ""} placeholder="File name" /></label>
        <label><span className="sr-only">Kind of record</span>
          <NativeSelect name="type" aria-label="Kind of record" value={type} placeholder="Any record" options={ENTITY_TYPES.map((t) => ({ value: t, label: RECORD_LABELS[t] ?? t }))} /></label>
        <Button variant="secondary">Search</Button>
        {(q || type) && <Link href={tabHref(tab)} className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      <DataTable id="documents" label={removed ? "Removed documents" : "Documents"} path={path} sp={sp} sort={sort} rows={rows} rowKey={(d) => d.id}
        columns={removed ? [...BASE, REMOVED_COL, ACTIONS_COL] : [...BASE, UPLOADED_COL]}
        select={{ rowLabel: (d) => d.fileName, what: "documents", actions: removed
          ? [{ label: "Restore selected", action: bulkRestoreDocumentsAction }]
          : [{ label: "Remove selected", action: bulkRemoveDocumentsAction, confirm: "Remove the ticked documents from their records? They are hidden from everyone and their files are kept; an administrator can restore them here." }],
          extra: <BulkHidden form="documents-selected" name="returnPath" value={here} /> }}
        empty={removed ? <EmptyState title="No removed documents">When someone removes a file from a record, it shows here.</EmptyState>
          : <EmptyState title={q || type ? "No documents match" : "No documents yet"}>Files attached to offers, purchase orders, assets and other records show here.</EmptyState>}
        footer={<ListPager paging={paging} path={path} sp={sp} what="documents" />} />
    </>
  );
}

type Doc = typeof documents.$inferSelect & { by: string | null };

const BASE: Column<Doc>[] = [
  { key: "file", label: "File", sort: true, cell: (d) => <><a href={d.url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">{d.fileName}</a><span className="block text-xs text-muted">{fileSize(d.sizeBytes)}{d.kind ? ` · ${d.kind.replace(/_/g, " ")}` : ""}</span></> },
  { key: "record", label: "Record", sort: true, cell: (d) => { const href = recordHref(d.entityType, d.entityId); const label = `${RECORD_LABELS[d.entityType] ?? d.entityType} ${d.entityId}`;
    return href ? <Link href={href} className="text-primary hover:underline">{label}</Link> : label; } },
  { key: "version", label: "Version", sort: true, align: "right", optional: true, cell: (d) => d.version },
];
const UPLOADED_COL: Column<Doc> = { key: "when", label: "Uploaded", sort: true, className: "whitespace-nowrap", cell: (d) => <>{formatDateTime(d.uploadedAt)}{d.by && <span className="block text-xs text-muted">{d.by}</span>}</> };
const REMOVED_COL: Column<Doc> = { key: "when", label: "Removed", sort: true, cell: (d) => removedLine(d.deletedAt, d.by, formatDateTime) };
const ACTIONS_COL: Column<Doc> = { key: "actions", label: "Actions", head: <span className="sr-only">Actions</span>, cell: (d) => (
  <div className="flex flex-wrap gap-2">
    <form action={restoreDocument}><input type="hidden" name="id" value={d.id} /><button className="min-h-8 px-2 text-sm font-semibold text-primary hover:underline">Restore</button></form>
    <form action={purgeDocument}><input type="hidden" name="id" value={d.id} />
      <ConfirmButton confirm={`Delete ${d.fileName} for good, with all its versions? The files are removed from storage and this can't be undone.`} tone="danger" confirmLabel="Delete for good"
        className="min-h-8 px-2 text-sm text-danger hover:underline" aria-label={`Delete ${d.fileName} for good`}>Delete for good</ConfirmButton>
    </form>
  </div>
) };

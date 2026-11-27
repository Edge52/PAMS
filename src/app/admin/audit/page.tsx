import Link from "next/link";
import { Button, Field, Input, PageHeader, Panel } from "@/components/ui";
import { NativeSelect } from "@/components/assets/bits";
import { requirePermission } from "@/lib/auth/session";
import { auditCount, auditFilter, auditRows, auditTypes, recordHref } from "@/lib/audit";
import { formatDateTime, formatNumber } from "@/lib/format";
import { desc } from "drizzle-orm";
import { activityLog } from "@/db/schema";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { fieldLabel, showValue } from "@/lib/audit-diff";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };
const SORT_KEYS = ["when", "who", "record", "what"] as const;

/** Audit log viewer (wave 12): who did what to which record, and when. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("users.manage");
  const sp = await searchParams;
  const f = auditFilter(sp);
  // Wave 41: 50 a page with the usual pager and sortable headings.
  const sort = tableSort(sp, SORT_KEYS);
  const [total, types] = await Promise.all([auditCount(f), auditTypes()]);
  const paging = pageFor(sp, total, PAGE_SIZE);
  const rows = await auditRows(f, paging.size, paging.offset, sqlOrder(sort, { when: activityLog.at, who: activityLog.actor, record: activityLog.entityType, what: activityLog.action }, [desc(activityLog.at)]));
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return `?${u.toString()}`;
  };
  return (
    <>
      <PageHeader title="Audit log" description="Every change recorded in the system: who, what, which record and when. Entries can't be edited or deleted."
        actions={<Link href={`/admin/audit/export${qs({ page: "" })}`} prefetch={false} className="text-sm font-semibold text-primary hover:underline">Export (CSV)</Link>} />
      <form className="mb-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Person"><Input name="who" defaultValue={f.who ?? ""} placeholder="Name" /></Field>
        <Field label="Kind of record"><NativeSelect name="type" value={f.type ?? ""} placeholder="Any" options={types.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} /></Field>
        <Field label="Record number"><Input name="id" inputMode="numeric" defaultValue={f.id ?? ""} /></Field>
        <Field label="Text"><Input name="q" defaultValue={f.q ?? ""} placeholder="e.g. approved" /></Field>
        <Field label="From"><Input type="date" name="from" defaultValue={f.from ?? ""} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={f.to ?? ""} /></Field>
        <div className="flex items-end gap-2"><Button variant="secondary">Search</Button><Link href="/admin/audit" className="text-sm text-muted hover:underline">Clear</Link></div>
      </form>
      <Panel title={`${formatNumber(total)} entr${total === 1 ? "y" : "ies"}`} padded={false}>
        <div className="p-3">
          <DataTable id="audit" label="Audit log" path="/admin/audit" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.id} columns={COLUMNS}
            empty={<p className="text-sm text-muted">No entries match.</p>}
            footer={<ListPager paging={paging} path="/admin/audit" sp={sp} what="entries" />} />
        </div>
      </Panel>
    </>
  );
}

type Entry = Awaited<ReturnType<typeof auditRows>>[number];

const COLUMNS: Column<Entry>[] = [
  { key: "when", label: "When", sort: true, className: "whitespace-nowrap", cell: (r) => formatDateTime(r.at) },
  { key: "who", label: "Who", sort: true, cell: (r) => r.actor ?? "System" },
  { key: "record", label: "Record", sort: true, className: "whitespace-nowrap", cell: (r) => { const h = recordHref(r.entityType, r.entityId);
    return h ? <Link href={h} className="text-primary hover:underline">{r.entityType.replace(/_/g, " ")} {r.entityId}</Link> : `${r.entityType.replace(/_/g, " ")} ${r.entityId || ""}`; } },
  { key: "what", label: "What", sort: true, cell: (r) => <><span className="text-muted">{r.action.replace(/_/g, " ")}:</span> {r.summary}
    {r.changes && (
      <details className="mt-1 text-xs"><summary className="cursor-pointer text-primary">Before and after ({Object.keys(r.changes).length})</summary>
        <table className="mt-1"><tbody>{Object.entries(r.changes).map(([k, c]) => (
          <tr key={k} className="align-top"><th scope="row" className="pr-3 text-left font-medium text-muted">{fieldLabel(k)}</th><td className="pr-2 text-muted line-through">{showValue(c.from)}</td><td>{showValue(c.to)}</td></tr>
        ))}</tbody></table>
      </details>
    )}</> },
  { key: "ip", label: "From address", optional: true, cellClassName: "whitespace-nowrap font-mono text-xs text-muted", cell: (r) => r.ip ?? "" },
];

import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceTypes, recalls } from "@/db/schema";
import { Badge, EmptyState, LinkButton, PageHeader, StatusBadge, TabLinks } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { Meter, Notice } from "@/components/assets/bits";
import { RECALL_ACTION_LABELS, type RecallAction } from "@/lib/assets/recalls";
import { sourceLabel } from "@/lib/assets/vigilance";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDate, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recalls" };

export default async function RecallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const tab = sp.tab === "closed" ? "closed" : sp.tab === "all" ? "all" : "open";
  // Device counts only for the user's hospitals.
  const inScope = scope === null ? sql`true` : scope.length ? sql`a.facility_id in (${sql.join(scope.map((s) => sql`${s}`), sql`, `)})` : sql`false`;
  const count = (status?: string) => sql<number>`(select count(*) from recall_assets x join assets a on a.id = x.asset_id
    where x.recall_id = ${recalls.id} and ${inScope}${status ? sql` and x.status = ${status}` : sql``})::int`;
  // Wave 41: counted, sorted and paged in the database.
  const where = tab === "all" ? undefined : eq(recalls.status, tab === "open" ? "OPEN" : "CLOSED");
  const sort = tableSort(sp, SORT_KEYS);
  const total = count(), pending = count("PENDING");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(recalls).where(where);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const rows = await db.select({ r: recalls, typeName: deviceTypes.name, total, pending })
    .from(recalls).leftJoin(deviceTypes, eq(deviceTypes.id, recalls.deviceTypeId)).where(where)
    .orderBy(...sqlOrder(sort, { number: recalls.number, devices: total, action: recalls.action, due: recalls.dueDate, pending, status: recalls.status },
      [desc(recalls.urgent), desc(recalls.createdAt)], [desc(recalls.id)]))
    .limit(paging.size).offset(paging.offset);
  const canEdit = can(me.role, "recalls.edit");
  const href = (t: string) => `/assets/recalls${t === "open" ? "" : `?tab=${t}`}`;
  return (
    <>
      <PageHeader title="Recalls and safety notices" description="Field safety notices from manufacturers and regulators, matched to the devices in your register, with each device tracked until it is dealt with."
        actions={canEdit && <span className="flex flex-wrap gap-2"><LinkButton href="/assets/recalls/import">Import an openFDA file</LinkButton><LinkButton href="/assets/recalls/new" variant="primary">Record a notice</LinkButton></span>} />
      <Notice sp={sp} />
      <TabLinks active={tab} tabs={[{ key: "open", label: "Open", href: href("open") }, { key: "closed", label: "Closed", href: href("closed") }, { key: "all", label: "All", href: href("all") }]} />
      {rows.length === 0 ? (
        <EmptyState title={tab === "open" ? "No open recalls" : "No recalls here"} action={canEdit ? <LinkButton href="/assets/recalls/new" variant="primary">Record a notice</LinkButton> : undefined}>
          When a manufacturer or the regulator issues a field safety notice, record it here. The system finds the affected devices.
        </EmptyState>
      ) : (
        <DataTable id="recalls" label="Recalls" path="/assets/recalls" sp={sp} sort={sort} rows={rows} rowKey={(x) => x.r.id} columns={COLUMNS}
          footer={<ListPager paging={paging} path="/assets/recalls" sp={sp} what="notices" />} />
      )}
    </>
  );
}

const SORT_KEYS = ["number", "devices", "action", "due", "pending", "status"] as const;
type Row = { r: typeof recalls.$inferSelect; typeName: string | null; total: number; pending: number };

const COLUMNS: Column<Row>[] = [
  { key: "number", label: "Notice", sort: true, cell: ({ r }) => <><Link href={`/assets/recalls/${r.id}`} className="font-semibold text-primary hover:underline">{r.number}</Link> {r.urgent && <Badge tone="danger">Urgent</Badge>}
    <div className="max-w-72 text-[13px]">{r.title}</div><div className="text-xs text-muted">{[sourceLabel(r.source), r.reference].filter(Boolean).join(" · ")}</div></> },
  { key: "devices", label: "Devices", sort: true, cell: ({ r, typeName }) => <>{[r.manufacturer, r.modelPattern].filter(Boolean).join(" ") || typeName || "—"}<div className="text-xs text-muted">{typeName && (r.manufacturer || r.modelPattern) ? typeName : ""}</div></> },
  { key: "action", label: "Required action", sort: true, optional: true, cellClassName: "text-[13px]", cell: ({ r }) => RECALL_ACTION_LABELS[r.action as RecallAction] },
  { key: "due", label: "Due", sort: true, className: "whitespace-nowrap", cell: ({ r }) => formatDate(r.dueDate) },
  { key: "pending", label: "Progress", sort: true, optional: true, className: "min-w-36", cell: ({ total, pending }) => {
    const pct = total ? Math.round(((total - pending) / total) * 100) : 100;
    return <><Meter pct={pct} tone={pending ? "warn" : "ok"} label="Devices dealt with" /><div className="mt-1 text-xs text-muted">{formatNumber(total - pending)} of {formatNumber(total)} done</div></>;
  } },
  { key: "status", label: "Status", sort: true, cell: ({ r }) => <StatusBadge value={r.status} /> },
];

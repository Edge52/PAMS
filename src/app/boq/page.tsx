import Link from "next/link";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqLines, boqs, facilities, projects, standardSets } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { DataTable, type Column } from "@/components/ui/data-table";
import { tableSort } from "@/components/ui/data-table-utils";
import { ListPager } from "@/components/list-pager";
import { PAGE_SIZE, pageFor, sqlOrder } from "@/lib/paging";
import { Notice } from "@/components/boq/notice";
import { formatDate, formatMoney, formatNumber, num } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "BOQs" };

export default async function BoqListPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; all?: string; page?: string; sort?: string; dir?: string }> }) {
  const me = await requirePermission("boq.view");
  const mayEdit = can(me.role, "boq.edit");
  const sp = await searchParams;
  const showAll = sp.all === "1";
  // Wave 41: counted, sorted and paged in the database; line totals only for the BOQs on the page (they used to be
  // added up for every BOQ).
  const sort = tableSort(sp, SORT_KEYS);
  const scope = scopeWhere(boqs.facilityId, await facilityScope(me));
  const where = and(scope, showAll ? undefined : ne(boqs.status, "SUPERSEDED"));
  const lineCount = sql<number>`(select count(*)::int from ${boqLines} where ${boqLines.boqId} = ${boqs.id})`;
  const [[{ n }], [{ hidden }]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(boqs).where(where),
    db.select({ hidden: sql<number>`count(*) filter (where ${boqs.status} = 'SUPERSEDED')::int` }).from(boqs).where(scope),
  ]);
  const paging = pageFor(sp, n, PAGE_SIZE);
  const page = await db.select({
    id: boqs.id, name: boqs.name, status: boqs.status, version: boqs.version, beds: boqs.totalHospitalBeds, currency: boqs.currency,
    contingencyPct: boqs.contingencyPct, updatedAt: boqs.updatedAt,
    facilityName: facilities.name, facilityId: boqs.facilityId, projectCode: projects.code, projectId: boqs.projectId, standardName: standardSets.name,
  }).from(boqs)
    .leftJoin(facilities, eq(facilities.id, boqs.facilityId))
    .leftJoin(projects, eq(projects.id, boqs.projectId))
    .innerJoin(standardSets, eq(standardSets.id, boqs.standardSetId))
    .where(where)
    .orderBy(...sqlOrder(sort, { name: boqs.name, facility: facilities.name, standard: standardSets.name, beds: boqs.totalHospitalBeds, lines: lineCount, status: boqs.status, updated: boqs.updatedAt },
      [desc(boqs.updatedAt)], [desc(boqs.id)]))
    .limit(paging.size).offset(paging.offset);
  const totals = page.length ? await db.select({
    boqId: boqLines.boqId, lines: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${boqLines.quantity}), 0)::int`,
    subtotal: sql<string>`coalesce(sum(${boqLines.quantity} * coalesce(${boqLines.unitPriceEstimate}, 0)), 0)`,
  }).from(boqLines).where(inArray(boqLines.boqId, page.map((r) => r.id))).groupBy(boqLines.boqId) : [];
  const byBoq = new Map(totals.map((t) => [t.boqId, t]));
  const rows = page.map((r) => ({ ...r, lines: byBoq.get(r.id)?.lines ?? 0, units: byBoq.get(r.id)?.units ?? 0, subtotal: byBoq.get(r.id)?.subtotal ?? "0" }));
  const columns: Column<(typeof rows)[number]>[] = [
    { key: "name", label: "Name", sort: true, cell: (r) => <><Link href={`/boq/${r.id}`} className="font-semibold text-primary hover:underline">{r.name}</Link>{r.version > 1 && <span className="ml-1.5 text-xs text-muted">v{r.version}</span>}</> },
    { key: "facility", label: "Facility / project", sort: true, optional: true, cell: (r) => <>
      {r.facilityName ? <Link href={`/facilities/${r.facilityId}`} className="hover:underline">{r.facilityName}</Link> : <span className="text-faint">No facility</span>}
      {r.projectCode && <span className="block text-xs text-muted"><Link href={`/procurement/${r.projectId}`} className="hover:underline">{r.projectCode}</Link></span>}</> },
    { key: "standard", label: "Standard set", sort: true, optional: true, cellClassName: "text-muted", cell: (r) => r.standardName },
    { key: "beds", label: "Beds", sort: true, align: "right", optional: true, cell: (r) => formatNumber(r.beds) },
    { key: "lines", label: "Lines", sort: true, align: "right", cell: (r) => <>{formatNumber(r.lines)}<span className="block text-xs text-muted">{formatNumber(r.units)} units</span></> },
    { key: "total", label: "Estimated total", align: "right", cellClassName: "font-semibold", cell: (r) => { const sub = num(r.subtotal); return formatMoney(sub + (sub * (r.contingencyPct || 0)) / 100, r.currency); } },
    { key: "status", label: "Status", sort: true, cell: (r) => <StatusBadge value={r.status} /> },
    { key: "updated", label: "Updated", sort: true, optional: true, className: "whitespace-nowrap", cellClassName: "text-muted", cell: (r) => formatDate(r.updatedAt) },
  ];

  return (
    <>
      <PageHeader title="BOQs"
        description="Bills of quantities generated from standard ratios — per department, priced, and ready to attach to a tender."
        actions={<>
          <LinkButton href="/boq/standards">Standards & ratios</LinkButton>
          {mayEdit && <LinkButton href="/boq/new">New BOQ</LinkButton>}
          {mayEdit && <LinkButton href="/boq/quick-start" variant="primary">Quick start</LinkButton>}
        </>} />
      <Notice notice={sp.notice} error={sp.error} />
      {n === 0 && hidden === 0 ? (
        <EmptyState title="No BOQs yet" action={mayEdit ? <LinkButton href="/boq/quick-start" variant="primary">Start with a few questions</LinkButton> : undefined}>
          Pick a standard set, describe the departments (or import them from a facility) and the quantities are worked out for you.
        </EmptyState>
      ) : (
        <>
          <DataTable id="boqs" label="BOQs" path="/boq" sp={sp} sort={sort} rows={rows} rowKey={(r) => r.id} columns={columns}
            footer={<ListPager paging={paging} path="/boq" sp={sp} what="BOQs" />} />
          {hidden > 0 && !showAll && (
            <p className="mt-3 text-sm text-muted">
              {hidden} superseded {hidden === 1 ? "version is" : "versions are"} hidden. <Link href="/boq?all=1" className="text-primary hover:underline">Show all versions</Link>
            </p>
          )}
          {showAll && <p className="mt-3 text-sm"><Link href="/boq" className="text-primary hover:underline">Hide superseded versions</Link></p>}
        </>
      )}
    </>
  );
}

const SORT_KEYS = ["name", "facility", "standard", "beds", "lines", "status", "updated"] as const;

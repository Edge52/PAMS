import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { boqLines, boqs, facilities, projects, standardSets } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th, THead } from "@/components/ui";
import { Notice } from "@/components/boq/notice";
import { formatDate, formatMoney, formatNumber, num } from "@/lib/format";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/procurement/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "BOQs" };

export default async function BoqListPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; all?: string }> }) {
  const me = await requirePermission("boq.view");
  const mayEdit = can(me.role, "boq.edit");
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const totals = db.select({
    boqId: boqLines.boqId,
    lines: sql<number>`count(*)::int`.as("lines"),
    units: sql<number>`coalesce(sum(${boqLines.quantity}), 0)::int`.as("units"),
    subtotal: sql<string>`coalesce(sum(${boqLines.quantity} * coalesce(${boqLines.unitPriceEstimate}, 0)), 0)`.as("subtotal"),
  }).from(boqLines).groupBy(boqLines.boqId).as("t");

  const rows = await db.select({
    id: boqs.id, name: boqs.name, status: boqs.status, version: boqs.version, beds: boqs.totalHospitalBeds, currency: boqs.currency,
    contingencyPct: boqs.contingencyPct, updatedAt: boqs.updatedAt,
    facilityName: facilities.name, facilityId: boqs.facilityId, projectCode: projects.code, projectId: boqs.projectId, standardName: standardSets.name,
    lines: totals.lines, units: totals.units, subtotal: totals.subtotal,
  }).from(boqs)
    .leftJoin(facilities, eq(facilities.id, boqs.facilityId))
    .leftJoin(projects, eq(projects.id, boqs.projectId))
    .innerJoin(standardSets, eq(standardSets.id, boqs.standardSetId))
    .leftJoin(totals, eq(totals.boqId, boqs.id))
    .where(scopeWhere(boqs.facilityId, await facilityScope(me)))
    .orderBy(desc(boqs.updatedAt));
  const visible = showAll ? rows : rows.filter((r) => r.status !== "SUPERSEDED");
  const hidden = rows.length - visible.length;

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
      {rows.length === 0 ? (
        <EmptyState title="No BOQs yet" action={mayEdit ? <LinkButton href="/boq/quick-start" variant="primary">Start with a few questions</LinkButton> : undefined}>
          Pick a standard set, describe the departments (or import them from a facility) and the quantities are worked out for you.
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Name</Th><Th>Facility / project</Th><Th>Standard set</Th><Th align="right">Beds</Th>
                <Th align="right">Lines</Th><Th align="right">Estimated total</Th><Th>Status</Th><Th>Updated</Th>
              </tr>
            </THead>
            <tbody>
              {visible.map((r) => {
                const sub = num(r.subtotal);
                const total = sub + (sub * (r.contingencyPct || 0)) / 100;
                return (
                  <tr key={r.id} className="hover:bg-sunken/50">
                    <Td>
                      <Link href={`/boq/${r.id}`} className="font-semibold text-primary hover:underline">{r.name}</Link>
                      {r.version > 1 && <span className="ml-1.5 text-xs text-muted">v{r.version}</span>}
                    </Td>
                    <Td>
                      {r.facilityName ? <Link href={`/facilities/${r.facilityId}`} className="hover:underline">{r.facilityName}</Link> : <span className="text-faint">No facility</span>}
                      {r.projectCode && <span className="block text-xs text-muted"><Link href={`/procurement/${r.projectId}`} className="hover:underline">{r.projectCode}</Link></span>}
                    </Td>
                    <Td className="text-muted">{r.standardName}</Td>
                    <Td align="right">{formatNumber(r.beds)}</Td>
                    <Td align="right">{formatNumber(r.lines ?? 0)}<span className="block text-xs text-muted">{formatNumber(r.units ?? 0)} units</span></Td>
                    <Td align="right" className="font-semibold">{formatMoney(total, r.currency)}</Td>
                    <Td><StatusBadge value={r.status} /></Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(r.updatedAt)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {hidden > 0 && (
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

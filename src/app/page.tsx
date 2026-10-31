import Link from "next/link";
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { facilityScope, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { pendingForUser } from "@/lib/approvals/server";
import { db } from "@/db";
import {
  activityLog, assets, boqs, facilities, floors, buildings, maintenanceEvents, offers, poLines,
  projects, purchaseOrders, rooms,
} from "@/db/schema";
import { EmptyState, Panel, PageHeader, LinkButton, Stat, StatusBadge, Table, THead, Th, Td } from "@/components/ui";
import { addDaysISO, addMonthsISO, daysUntil, formatDate, formatMoney, formatNumber, num, todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

const OPEN_PROJECT = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY"] as const;
const OPEN_PO = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED"] as const;
const PRE_AWARD: readonly string[] = ["PLANNING", "SPECIFICATION", "RFQ", "EVALUATION"];

const ENTITY_HREF: Record<string, (id: number) => string> = {
  asset: (id) => `/assets/${id}`, offer: (id) => `/procurement/offers/${id}`, po: (id) => `/procurement/purchase-orders/${id}`,
  project: (id) => `/procurement/${id}`, supplier: (id) => `/procurement/suppliers/${id}`, boq: (id) => `/boq/${id}`,
};

export default async function Dashboard() {
  const me = await requireUser();
  const scope = await facilityScope(me);
  /** Facility filter: assets always have a facility; projects/POs/BOQs without one are visible to everyone. */
  const own = (col: PgColumn): SQL | undefined => (scope === null ? undefined : scope.length ? inArray(col, scope) : sql`false`);
  const ownOrNone = (col: PgColumn): SQL | undefined => (scope === null ? undefined : or(isNull(col), scope.length ? inArray(col, scope) : sql`false`));
  const waiting = await pendingForUser(me);
  const today = todayISO();
  const in90 = addMonthsISO(today, 3);
  const in14 = addDaysISO(today, 14);

  const [
    assetTotals, statusRows, warrantySoon, overduePm, openProjects, expiringOffers, openPoValue, boqCount,
    tenders, floorLoad, recent,
  ] = await Promise.all([
    db.select({ n: count() }).from(assets).where(and(sql`${assets.status} <> 'DISPOSED'`, own(assets.facilityId))),
    db.select({ status: assets.status, n: count() }).from(assets).where(own(assets.facilityId)).groupBy(assets.status),
    db.select({ n: count() }).from(assets).where(and(isNotNull(assets.warrantyEnd), gte(assets.warrantyEnd, today), lte(assets.warrantyEnd, in90), own(assets.facilityId))),
    db.select({ n: count() }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
      .where(and(inArray(maintenanceEvents.status, ["SCHEDULED", "OVERDUE"]), lte(maintenanceEvents.scheduledDate, today), own(assets.facilityId))),
    db.select({ n: count() }).from(projects).where(and(inArray(projects.status, [...OPEN_PROJECT]), ownOrNone(projects.facilityId))),
    db.select({ n: count() }).from(offers).innerJoin(projects, eq(projects.id, offers.projectId))
      .where(and(notInArray(offers.status, ["REJECTED", "WITHDRAWN", "AWARDED"]), isNotNull(offers.validUntil), lte(offers.validUntil, in14), ownOrNone(projects.facilityId))),
    db.select({
      currency: purchaseOrders.currency,
      value: sql<string>`coalesce(sum(${poLines.quantity} * ${poLines.unitPrice}), 0)`,
    }).from(purchaseOrders).innerJoin(poLines, eq(poLines.poId, purchaseOrders.id))
      .where(and(inArray(purchaseOrders.status, [...OPEN_PO]), ownOrNone(purchaseOrders.facilityId))).groupBy(purchaseOrders.currency),
    db.select({ n: count() }).from(boqs).where(ownOrNone(boqs.facilityId)),
    db.select({
      id: projects.id, code: projects.code, title: projects.title, client: projects.client, status: projects.status,
      deadline: projects.submissionDeadline,
      offerCount: sql<number>`(select count(*)::int from "offers" o where o."project_id" = "projects"."id")`,
    }).from(projects).where(and(inArray(projects.status, [...OPEN_PROJECT]), ownOrNone(projects.facilityId)))
      .orderBy(sql`${projects.submissionDeadline} asc nulls last`).limit(6),
    db.select({
      floorId: floors.id, floor: floors.name, level: floors.level, building: buildings.name, facility: facilities.name,
      total: sql<number>`count(${assets.id})::int`,
      down: sql<number>`count(${assets.id}) filter (where ${assets.status} in ('UNDER_MAINTENANCE','OUT_OF_SERVICE'))::int`,
    }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .innerJoin(facilities, eq(facilities.id, buildings.facilityId))
      .leftJoin(rooms, eq(rooms.floorId, floors.id)).leftJoin(assets, eq(assets.roomId, rooms.id))
      .where(own(buildings.facilityId))
      .groupBy(floors.id, floors.name, floors.level, buildings.name, facilities.name).orderBy(facilities.name, buildings.name, floors.level),
    // Facility-limited users see their own recent actions (the log isn't facility-tagged).
    db.select().from(activityLog).where(scope === null ? undefined : eq(activityLog.actor, me.name)).orderBy(desc(activityLog.at)).limit(10),
  ]);

  const total = assetTotals[0]?.n ?? 0;
  const byStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  const inService = (byStatus.IN_SERVICE ?? 0) + (byStatus.INSTALLED ?? 0);
  const down = (byStatus.UNDER_MAINTENANCE ?? 0) + (byStatus.OUT_OF_SERVICE ?? 0);
  const maxFloor = Math.max(1, ...floorLoad.map((f) => f.total));
  const multiFacility = new Set(floorLoad.map((f) => f.facility)).size > 1;
  const isEmpty = total === 0 && (openProjects[0]?.n ?? 0) === 0 && (boqCount[0]?.n ?? 0) === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Tenders in flight, equipment on every floor, and what needs attention this week."
        actions={<>
          {can(me.role, "boq.edit") && <LinkButton href="/boq/new">New BOQ</LinkButton>}
          {can(me.role, "procurement.edit") && <LinkButton href="/procurement/new" variant="primary">New project</LinkButton>}
        </>}
      />

      {isEmpty && (
        <div className="mb-6">
          <EmptyState title="Nothing here yet" action={<LinkButton href="/facilities" variant="primary">Set up a facility</LinkButton>}>
            Start by adding your hospital, its floors and departments. Then plan a BOQ, run the tender, and every device you receive lands on the floor map.
          </EmptyState>
        </div>
      )}

      {waiting.length > 0 && (
        <Panel title={`Waiting for your approval (${waiting.length})`} className="mb-6" padded={false}
          actions={<Link href="/approvals" className="text-sm font-semibold text-primary hover:underline">All approvals</Link>}>
          <ul className="divide-y divide-line">
            {waiting.slice(0, 5).map((w) => (
              <li key={w.step.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <Link href={w.request.href} className="font-semibold text-primary hover:underline">{w.request.title}</Link>
                <span className="text-xs text-muted">{w.mode === "paper" ? `Record ${w.step.memberName ?? "member"}'s signature` : w.step.label} · since {formatDate(w.request.requestedAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Assets tracked" value={formatNumber(total)}
          hint={total ? `${Math.round((inService / total) * 100)}% in service` : undefined} href="/assets" />
        <Stat label="Down for maintenance or out of service" value={formatNumber(down)} href="/assets?status=UNDER_MAINTENANCE" />
        <Stat label="Planned maintenance due" value={formatNumber(overduePm[0]?.n ?? 0)}
          hint={`${formatNumber(warrantySoon[0]?.n ?? 0)} warranties end within 90 days`} href="/assets/maintenance" />
        <Stat label="Open projects" value={formatNumber(openProjects[0]?.n ?? 0)}
          hint={`${formatNumber(expiringOffers[0]?.n ?? 0)} offers expire within 14 days`} href="/procurement" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-3">
          <Panel title="Tenders by deadline" padded={false}
            actions={<Link href="/procurement" className="text-sm text-primary hover:underline">All projects</Link>}>
            {tenders.length === 0 ? (
              <p className="p-4 text-sm text-muted">No open projects. Create one to start collecting offers.</p>
            ) : (
              <Table className="rounded-none border-0">
                <THead><tr><Th>Project</Th><Th>Client</Th><Th>Status</Th><Th align="right">Offers</Th><Th align="right">Deadline</Th></tr></THead>
                <tbody>
                  {tenders.map((t) => {
                    // The submission deadline only matters until the tender is evaluated.
                    const d = PRE_AWARD.includes(t.status) ? daysUntil(t.deadline) : null;
                    return (
                      <tr key={t.id}>
                        <Td><Link href={`/procurement/${t.id}`} className="font-semibold text-primary hover:underline">{t.title}</Link>
                          <span className="block text-xs text-muted">{t.code}</span></Td>
                        <Td>{t.client ?? "—"}</Td>
                        <Td><StatusBadge value={t.status} /></Td>
                        <Td align="right">{t.offerCount}</Td>
                        <Td align="right">
                          {formatDate(t.deadline)}
                          {d !== null && <span className={`block text-xs ${d < 0 ? "text-danger" : d <= 7 ? "text-warn" : "text-muted"}`}>
                            {d < 0 ? `${-d} days ago` : d === 0 ? "today" : `in ${d} days`}</span>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Equipment by floor" actions={<Link href="/assets/map" className="text-sm text-primary hover:underline">Open floor map</Link>}>
            {floorLoad.length === 0 ? <p className="text-sm text-muted">No floors set up yet.</p> : (
              <ul className="space-y-2">
                {floorLoad.map((f) => (
                  <li key={f.floorId}>
                    <Link href={`/assets/map?floorId=${f.floorId}`} className="group grid grid-cols-[9rem_1fr_4.5rem] items-center gap-3 text-sm">
                      <span className="truncate group-hover:text-primary">{f.floor}<span className="block text-xs text-muted">{multiFacility ? `${f.facility} · ${f.building}` : f.building}</span></span>
                      <span className="relative h-3 overflow-hidden rounded-sm bg-sunken" aria-hidden>
                        <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${(f.total / maxFloor) * 100}%` }} />
                        <span className="absolute inset-y-0 left-0 bg-tag" style={{ width: `${(f.down / maxFloor) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{f.total}{f.down > 0 && <span className="block text-xs text-warn">{f.down} down</span>}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Bar length is assets on the floor; the amber segment is equipment under maintenance or out of service.</p>
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-2">
          <Panel title="Open purchase orders">
            {openPoValue.length === 0 ? <p className="text-sm text-muted">No open purchase orders.</p> : (
              <ul className="space-y-1 text-sm">
                {openPoValue.map((r) => (
                  <li key={r.currency} className="flex justify-between"><span className="text-muted">{r.currency}</span>
                    <span className="font-semibold">{formatMoney(num(r.value), r.currency)}</span></li>
                ))}
              </ul>
            )}
            <Link href="/procurement/purchase-orders" className="mt-3 inline-block text-sm text-primary hover:underline">Track deliveries</Link>
          </Panel>

          <Panel title="Recent activity" padded={false}>
            {recent.length === 0 ? <p className="p-4 text-sm text-muted">Changes to projects, offers, orders and assets appear here.</p> : (
              <ul className="divide-y divide-line">
                {recent.map((a) => {
                  const href = ENTITY_HREF[a.entityType]?.(a.entityId);
                  return (
                    <li key={a.id} className="px-4 py-2.5 text-sm">
                      {href ? <Link href={href} className="hover:text-primary">{a.summary}</Link> : a.summary}
                      <span className="block text-xs text-muted">{formatDate(a.at)}{a.actor ? `, ${a.actor}` : ""}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { and, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, departments, deviceTypes, rooms, users, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, LinkButton, PageHeader, Stat, StatusBadge, TabLinks, Table, Td, Th, THead } from "@/components/ui";
import { enumOptions, NativeSelect, Notice, Pager } from "@/components/assets/bits";
import { scopeWhere } from "@/lib/assets/access";
import {
  ACTIVE_STATUSES, formatHours, isLate, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, workOrderKpis,
} from "@/lib/assets/work-orders";
import { maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work orders" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const PAGE = 50;
const TABS = ["open", "mine", "unassigned", "done", "all"] as const;
const KPI_DAYS = 90;
const assignee = alias(users, "assignee");

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const canAssign = can(me.role, "workorders.assign"), canWork = can(me.role, "maintenance.edit");
  const tab = TABS.find((t) => t === one(sp, "tab")) ?? (canWork && !canAssign ? "mine" : "open");
  const status = WORK_ORDER_STATUSES.find((s) => s === one(sp, "status"));
  const priority = WORK_ORDER_PRIORITIES.find((s) => s === one(sp, "priority"));
  const q = one(sp, "q");
  const page = Math.max(1, Number(one(sp, "page")) || 1);
  const now = new Date();

  const conds: (SQL | undefined)[] = [scopeWhere(workOrders.facilityId, scope)];
  if (tab === "open") conds.push(inArray(workOrders.status, [...ACTIVE_STATUSES]));
  if (tab === "mine") conds.push(eq(workOrders.assignedToId, me.id), inArray(workOrders.status, [...ACTIVE_STATUSES, "COMPLETED"]));
  if (tab === "unassigned") conds.push(eq(workOrders.status, "OPEN"));
  if (tab === "done") conds.push(inArray(workOrders.status, ["COMPLETED", "CLOSED", "CANCELLED"]));
  if (status) conds.push(eq(workOrders.status, status));
  if (priority) conds.push(eq(workOrders.priority, priority));
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(sql`${workOrders.number} ilike ${like}`, sql`${assets.assetTag} ilike ${like}`, sql`${workOrders.title} ilike ${like}`, sql`${deviceTypes.name} ilike ${like}`));
  }
  const where = and(...conds);

  const since = new Date(now.getTime() - KPI_DAYS * 86_400_000);
  const [rows, [{ n: total }], kpiRows] = await Promise.all([
    db.select({
      wo: workOrders, tag: assets.assetTag, typeName: deviceTypes.name, roomCode: rooms.code, departmentName: departments.name, assigneeName: assignee.name,
    }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(rooms, eq(rooms.id, assets.roomId)).leftJoin(departments, eq(departments.id, assets.departmentId))
      .leftJoin(assignee, eq(assignee.id, workOrders.assignedToId)).where(where)
      .orderBy(sql`case ${workOrders.priority} when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end`, desc(workOrders.reportedAt))
      .limit(PAGE).offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(workOrders).innerJoin(assets, eq(assets.id, workOrders.assetId))
      .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(where),
    // KPIs: every job still open plus everything reported in the last 90 days, in the user's facilities.
    db.select({
      assetId: workOrders.assetId, type: workOrders.type, status: workOrders.status, priority: workOrders.priority, deviceDown: workOrders.deviceDown,
      reportedAt: workOrders.reportedAt, dueAt: workOrders.dueAt, startedAt: workOrders.startedAt, completedAt: workOrders.completedAt,
      downtimeStart: workOrders.downtimeStart, downtimeEnd: workOrders.downtimeEnd,
    }).from(workOrders).where(and(scopeWhere(workOrders.facilityId, scope), or(gte(workOrders.reportedAt, since), inArray(workOrders.status, [...ACTIVE_STATUSES])))),
  ]);
  const k = workOrderKpis(kpiRows, now);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base = { tab, status, priority, q, ...over };
    for (const [key, v] of Object.entries(base)) if (v !== undefined && v !== "" && !(key === "page" && String(v) === "1")) p.set(key, String(v));
    return `/assets/work-orders?${p}`;
  };

  return (
    <>
      <PageHeader title="Work orders" description="Fault reports and maintenance jobs, from report to sign-off. Response targets: urgent 4 h, high 24 h, normal 3 days, low 7 days."
        actions={<LinkButton href="/assets/work-orders/new" variant="primary">Report a fault</LinkButton>} />
      <Notice sp={sp} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open jobs" value={formatNumber(k.open)} hint={k.urgentOpen ? `${k.urgentOpen} urgent` : undefined} href={qs({ tab: "open", status: undefined, page: 1 })} />
        <Stat label="Past response target" value={formatNumber(k.late)} hint="Open, not started in time" />
        <Stat label="Mean time to repair" value={formatHours(k.mttrHours)} hint={`Corrective, last ${KPI_DAYS} days`} />
        <Stat label="Response on time" value={k.onTimePct == null ? "—" : `${Math.round(k.onTimePct)}%`} hint={`Mean response ${formatHours(k.meanResponseHours)}`} />
        <Stat label="Downtime" value={formatHours(k.downtimeHours)} hint={k.mtbfDays == null ? "Devices out of use" : `MTBF ${Math.round(k.mtbfDays)} days`} />
      </div>

      <TabLinks active={tab} tabs={[
        { key: "open", label: "Open", href: qs({ tab: "open", page: 1 }) },
        ...(canWork ? [{ key: "mine", label: "Assigned to me", href: qs({ tab: "mine", page: 1 }) }] : []),
        { key: "unassigned", label: "Waiting for assignment", href: qs({ tab: "unassigned", page: 1 }) },
        { key: "done", label: "Done", href: qs({ tab: "done", page: 1 }) },
        { key: "all", label: "All", href: qs({ tab: "all", page: 1 }) },
      ]} />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/assets/work-orders">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-48 flex-1 flex-col text-xs text-muted">Search
          <input name="q" defaultValue={q} placeholder="Number, asset tag, device or fault"
            className="mt-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[14px] text-ink" />
        </label>
        <label className="flex flex-col text-xs text-muted">Status
          <NativeSelect name="status" options={enumOptions(WORK_ORDER_STATUSES)} value={status} placeholder="Any status" className="mt-1" />
        </label>
        <label className="flex flex-col text-xs text-muted">Priority
          <NativeSelect name="priority" options={enumOptions(WORK_ORDER_PRIORITIES)} value={priority} placeholder="Any priority" className="mt-1" />
        </label>
        <Button variant="secondary">Filter</Button>
        {(q || status || priority) && <Link href={qs({ q: undefined, status: undefined, priority: undefined, page: 1 })} className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        <EmptyState title={tab === "mine" ? "Nothing assigned to you" : "No work orders here"}
          action={<LinkButton href="/assets/work-orders/new" variant="primary">Report a fault</LinkButton>}>
          {tab === "mine" ? "Jobs the biomedical lead gives you appear here." : "When a device fails, report it here or from the device's page — scanning its label opens it."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <THead><tr><Th>Work order</Th><Th>Device</Th><Th>Location</Th><Th>Priority</Th><Th>Status</Th><Th>Assigned to</Th><Th>Reported</Th></tr></THead>
            <tbody>
              {rows.map(({ wo, tag, typeName, roomCode, departmentName, assigneeName }) => {
                const late = isLate(wo, now);
                return (
                  <tr key={wo.id} className="hover:bg-sunken/50">
                    <Td>
                      <Link href={`/assets/work-orders/${wo.id}`} className="font-semibold text-primary hover:underline">{wo.number}</Link>
                      <div className="max-w-72 text-[13px]">{wo.title}</div>
                      <div className="text-xs text-muted">{maintenanceTypeLabel(wo.type)}{wo.deviceDown && " · device out of use"}</div>
                    </Td>
                    <Td><Link href={`/assets/${wo.assetId}`} className="text-primary hover:underline">{tag}</Link><div className="text-xs text-muted">{typeName}</div></Td>
                    <Td>{departmentName ?? "—"}<div className="text-xs text-muted">{roomCode ?? ""}</div></Td>
                    <Td><StatusBadge value={wo.priority} />{late && <div className="mt-1"><Badge tone="danger">Late</Badge></div>}</Td>
                    <Td><StatusBadge value={wo.status} />{wo.status === "ON_HOLD" && wo.holdReason && <div className="mt-1 max-w-48 text-xs text-muted">{wo.holdReason}</div>}</Td>
                    <Td>{assigneeName ?? <span className="text-muted">Not assigned</span>}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(wo.reportedAt)}<div className="text-xs text-muted">{wo.reportedByName}</div></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>{formatNumber(total)} work order{total === 1 ? "" : "s"}</span>
            <Pager page={page} pages={Math.ceil(total / PAGE)} href={(p) => qs({ page: p })} />
          </div>
        </>
      )}
    </>
  );
}

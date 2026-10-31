import Link from "next/link";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, maintenanceEvents, rooms, suppliers, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, FormGrid, Input, LinkButton, PageHeader, Panel, Stat, StatusBadge, TabLinks, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { enumOptions, NativeSelect, Notice } from "@/components/assets/bits";
import { addDays, addMonths, monthLabel, startOfMonth, endOfMonth } from "@/lib/assets/dates";
import { ASSET_CONDITIONS } from "@/lib/assets/filters";
import { displayEventStatus, dueState, groupByMonth, nextPpmDue, warrantyState, maintenanceTypeLabel } from "@/lib/assets/maintenance";
import { locationTree } from "@/lib/assets/queries";
import { CURRENCIES, formatDate, formatNumber, todayISO } from "@/lib/format";
import { humanize } from "@/lib/status";
import { completeEventAction, generatePpmAction, logMaintenanceAction } from "../actions";
import { createPpmWorkOrdersAction } from "../work-orders/actions";
import { assignableUsers, assignableUsersAll } from "@/lib/assets/work-order-server";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere, type Scope } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Maintenance" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const iso = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const canMaint = can(me.role, "maintenance.edit");
  const sp = await searchParams;
  const tab = (["due", "schedule", "warranty"] as const).find((t) => t === one(sp, "tab")) ?? "due";
  const today = todayISO();
  const deptId = Number(one(sp, "departmentId")) || undefined;
  const q = one(sp, "q")?.toUpperCase();

  // One query: every asset in use with its PPM interval, last completed PPM and next open PPM.
  const list = await db.select({
    id: assets.id, tag: assets.assetTag, status: assets.status, installDate: assets.installDate, purchaseDate: assets.purchaseDate,
    warrantyEnd: assets.warrantyEnd, manufacturer: assets.manufacturer, model: assets.model, departmentId: assets.departmentId,
    typeCode: deviceTypes.code, typeName: deviceTypes.name, ppmIntervalMonths: deviceTypes.ppmIntervalMonths, criticality: assets.criticality,
    departmentName: departments.name, roomCode: rooms.code, roomName: rooms.name,
    lastPpm: sql<string | null>`(select max(m.completed_date) from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status = 'COMPLETED')`,
    openPpm: sql<string | null>`(select min(m.scheduled_date) from maintenance_events m where m.asset_id = ${assets.id} and m.type = 'PPM' and m.status in ('SCHEDULED','IN_PROGRESS','OVERDUE'))`,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(sql`${assets.status} in ('INSTALLED','IN_SERVICE','UNDER_MAINTENANCE','OUT_OF_SERVICE')`, deptId ? eq(assets.departmentId, deptId) : undefined,
      q ? sql`(${assets.assetTag} ilike ${"%" + q + "%"} or ${assets.serialNumber} ilike ${"%" + q + "%"})` : undefined,
      scopeWhere(assets.facilityId, scope)))
    .orderBy(asc(assets.assetTag));

  const withDue = list.map((a) => {
    const n = nextPpmDue({ id: a.id, status: a.status, installDate: a.installDate, purchaseDate: a.purchaseDate, ppmIntervalMonths: a.ppmIntervalMonths, lastPpmDate: a.lastPpm });
    return { ...a, due: n.due, interval: n.intervalMonths, isDefault: n.isDefaultInterval, state: dueState(n.due, today) };
  });
  const overdue = withDue.filter((a) => a.state === "OVERDUE");
  const dueSoon = withDue.filter((a) => a.state === "DUE_SOON");
  const warrantySoon = withDue.filter((a) => warrantyState(a.warrantyEnd, today).state === "EXPIRING");
  const [{ thisMonth }] = await db.select({ thisMonth: sql<number>`count(*)::int` }).from(maintenanceEvents)
    .innerJoin(assets, eq(assets.id, maintenanceEvents.assetId))
    .where(and(eq(maintenanceEvents.status, "SCHEDULED"), gte(maintenanceEvents.scheduledDate, startOfMonth(today)), lte(maintenanceEvents.scheduledDate, endOfMonth(today)),
      scopeWhere(assets.facilityId, scope)));
  const tree = await locationTree(undefined, scope);
  const base = (t: string) => `/assets/maintenance?tab=${t}${deptId ? `&departmentId=${deptId}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader title="Maintenance" description="Planned preventive maintenance due from each device type's interval and the last completed PPM, plus warranties ending soon." />
      <Notice sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="PPM overdue" value={formatNumber(overdue.length)} href={base("due")} hint={overdue.length ? "Past their due date" : "Nothing overdue"} />
        <Stat label="Due in the next 30 days" value={formatNumber(dueSoon.length)} href={base("due")} />
        <Stat label="Scheduled this month" value={formatNumber(thisMonth)} href={base("schedule")} />
        <Stat label="Warranties ending in 90 days" value={formatNumber(warrantySoon.length)} href={base("warranty")} />
      </div>
      <form action="/assets/maintenance" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value={tab} />
        <label className="min-w-[12rem]"><span className="sr-only">Department</span>
          <NativeSelect name="departmentId" aria-label="Department" options={tree.departments.map((d) => ({ value: d.id, label: d.name }))} value={deptId} placeholder="All departments" /></label>
        <label><span className="sr-only">Tag or serial</span><Input name="q" defaultValue={q} placeholder="Tag or serial" /></label>
        <Button variant="secondary">Filter</Button>
        {(deptId || q) && <Link href={`/assets/maintenance?tab=${tab}`} className="px-2 py-1.5 text-sm text-primary hover:underline">Clear</Link>}
      </form>
      <TabLinks active={tab} tabs={[
        { key: "due", label: `Due and overdue (${overdue.length + dueSoon.length})`, href: base("due") },
        { key: "schedule", label: "Schedule", href: base("schedule") },
        { key: "warranty", label: `Warranty (${warrantySoon.length})`, href: base("warranty") },
      ]} />
      {tab === "due" && <DueTab rows={[...overdue, ...dueSoon]} today={today} returnPath={base("due")} canMaint={canMaint} />}
      {tab === "schedule" && <ScheduleTab sp={sp} deptId={deptId} q={q} today={today} departments={tree.departments} returnPath={base("schedule")} scope={scope} canMaint={canMaint} />}
      {tab === "warranty" && <WarrantyTab rows={withDue} today={today} />}
    </>
  );
}

type DueRow = { id: number; tag: string; typeName: string; typeCode: string; departmentName: string | null; roomCode: string | null; roomName: string | null;
  lastPpm: string | null; openPpm: string | null; due: string | null; interval: number; isDefault: boolean; state: string; criticality: string | null };

function DueTab({ rows, today, returnPath, canMaint }: { rows: DueRow[]; today: string; returnPath: string; canMaint: boolean }) {
  if (!rows.length) return <EmptyState title="Nothing due in the next 30 days">Every asset in use is within its planned maintenance interval.</EmptyState>;
  const sorted = [...rows].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  return (
    <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
      <table className="w-full border-collapse text-[14px]">
        <thead className="bg-sunken text-left text-[13px] text-muted"><tr>
          <th className="px-3 py-2 font-semibold">Asset</th><th className="px-3 py-2 font-semibold">Location</th><th className="px-3 py-2 font-semibold">Last PPM</th>
          <th className="px-3 py-2 font-semibold">Interval</th><th className="px-3 py-2 font-semibold">Due</th><th className="px-3 py-2 font-semibold">Planned</th>
        </tr></thead>
        <tbody>
          {sorted.map((a) => {
            const late = a.due && a.due < today ? Math.round((Date.parse(today) - Date.parse(a.due)) / 86_400_000) : 0;
            return (
              <tr key={a.id} className="border-t border-line align-top">
                <td className="px-3 py-2"><Link href={`/assets/${a.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{a.tag}</Link>
                  <div className="text-xs text-muted">{a.typeName}{a.criticality === "LIFE_SUPPORT" && <> · <span className="font-semibold text-danger">life support</span></>}</div></td>
                <td className="px-3 py-2">{a.departmentName ?? "—"}<div className="text-xs text-muted">{a.roomName}</div></td>
                <td className="whitespace-nowrap px-3 py-2">{a.lastPpm ? formatDate(a.lastPpm) : <span className="text-muted">Never</span>}</td>
                <td className="whitespace-nowrap px-3 py-2">{a.interval} months{a.isDefault && <span className="text-xs text-muted"> (default)</span>}</td>
                <td className="whitespace-nowrap px-3 py-2">{formatDate(a.due)}<div>{a.state === "OVERDUE" ? <Badge tone="danger">{late} days overdue</Badge> : <Badge tone="warn">Due soon</Badge>}</div></td>
                <td className="px-3 py-2">
                  {a.openPpm ? <span className="text-sm">Scheduled {formatDate(a.openPpm)}</span> : !canMaint ? <span className="text-sm text-muted">Not scheduled</span> : (
                    <ActionForm action={logMaintenanceAction} className="flex items-center gap-2">
                      <input type="hidden" name="assetId" value={a.id} />
                      <input type="hidden" name="type" value="PPM" /><input type="hidden" name="status" value="SCHEDULED" />
                      <input type="hidden" name="returnPath" value={returnPath} />
                      <input type="date" name="scheduledDate" defaultValue={a.due && a.due > today ? a.due : addDays(today, 3)} aria-label={`Schedule date for ${a.tag}`}
                        className="rounded-[var(--radius-control)] border border-line px-2 py-1 text-sm" />
                      <Button variant="secondary" className="py-1">Schedule</Button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

async function ScheduleTab({ sp, deptId, q, today, departments: depts, returnPath, scope, canMaint }: {
  sp: SP; deptId?: number; q?: string; today: string; departments: { id: number; name: string }[]; returnPath: string; scope: Scope; canMaint: boolean;
}) {
  const from = iso(one(sp, "from")) ?? startOfMonth(addMonths(today, -1));
  const to = iso(one(sp, "to")) ?? endOfMonth(addMonths(today, 3));
  const completeId = canMaint ? Number(one(sp, "complete")) || null : null;
  const [events, vendors, completing] = await Promise.all([
    db.select({
      id: maintenanceEvents.id, type: maintenanceEvents.type, status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate,
      completedDate: maintenanceEvents.completedDate, performedBy: maintenanceEvents.performedBy, findings: maintenanceEvents.findings,
      assetId: assets.id, tag: assets.assetTag, typeName: deviceTypes.name, departmentName: departments.name, roomCode: rooms.code,
      woId: workOrders.id, woNumber: workOrders.number,
    }).from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .leftJoin(departments, eq(departments.id, assets.departmentId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
      .leftJoin(workOrders, eq(workOrders.plannedEventId, maintenanceEvents.id))
      .where(and(gte(sql`coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate})`, from), lte(sql`coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate})`, to),
        deptId ? eq(assets.departmentId, deptId) : undefined, q ? sql`${assets.assetTag} ilike ${"%" + q + "%"}` : undefined, scopeWhere(assets.facilityId, scope)))
      .orderBy(asc(sql`coalesce(${maintenanceEvents.completedDate}, ${maintenanceEvents.scheduledDate})`), asc(assets.assetTag)).limit(3000),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
    completeId ? db.select({ id: maintenanceEvents.id, type: maintenanceEvents.type, status: maintenanceEvents.status, scheduledDate: maintenanceEvents.scheduledDate, tag: assets.assetTag, assetStatus: assets.status, typeName: deviceTypes.name })
      .from(maintenanceEvents).innerJoin(assets, eq(assets.id, maintenanceEvents.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(maintenanceEvents.id, completeId), scopeWhere(assets.facilityId, scope))) : Promise.resolve([]),
  ]);
  const months = groupByMonth(events, (e) => e.completedDate ?? e.scheduledDate);
  // People who can take PPM jobs: everyone with maintenance rights in the user's hospitals (deduplicated).
  const people = canMaint ? [...new Map((await Promise.all((scope ?? [null]).map((f) => (f === null ? assignableUsersAll() : assignableUsers(f))))).flat().map((u) => [u.id, u])).values()] : [];
  const c = completing[0];
  return (
    <div className="space-y-5">
      {c && c.status !== "COMPLETED" && (
        <Panel title={<span id="complete">Complete {maintenanceTypeLabel(c.type)} — <span className="font-mono">{c.tag}</span></span>} className="border-primary">
          <p className="mb-3 text-sm text-muted">{c.typeName} · scheduled {formatDate(c.scheduledDate)} · asset is {humanize(c.assetStatus).toLowerCase()}</p>
          <ActionForm action={completeEventAction}>
            <input type="hidden" name="eventId" value={c.id} />
            <input type="hidden" name="returnPath" value={returnPath} />
            <FormGrid cols={4}>
              <Field label="Completed on"><Input type="date" name="completedDate" defaultValue={today} max={today} required /></Field>
              <Field label="Performed by"><Input name="performedBy" placeholder="Technician name" /></Field>
              <Field label="Vendor"><NativeSelect name="vendorId" options={vendors.map((v) => ({ value: v.id, label: v.name }))} placeholder="In-house" /></Field>
              <Field label="Downtime (hours)"><Input type="number" name="downtimeHours" min={0} step="0.5" /></Field>
              <Field label="Cost"><Input type="number" name="cost" min={0} step="0.01" /></Field>
              <Field label="Currency"><NativeSelect name="currency" options={CURRENCIES.map((x) => ({ value: x, label: x }))} value="EGP" /></Field>
              <Field label="Condition after"><NativeSelect name="condition" options={enumOptions(ASSET_CONDITIONS)} placeholder="Unchanged" /></Field>
              <div className="flex items-end pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="returnToService" defaultChecked={c.assetStatus !== "IN_SERVICE"} /> Return the asset to service</label></div>
              <Field label="Findings" className="sm:col-span-2 lg:col-span-4"><Textarea name="findings" rows={2} placeholder="Checks performed, parts replaced, safety test result" /></Field>
            </FormGrid>
            <div className="mt-4 flex gap-2"><Button>Mark complete</Button><LinkButton href={returnPath} variant="ghost">Cancel</LinkButton></div>
          </ActionForm>
        </Panel>
      )}
      {canMaint && <Panel title="Create work orders for scheduled visits">
        <ActionForm action={createPpmWorkOrdersAction} className="flex flex-wrap items-end gap-3">
          <Field label="Visits from"><Input type="date" name="from" defaultValue={today} required /></Field>
          <Field label="to"><Input type="date" name="to" defaultValue={endOfMonth(today)} required /></Field>
          <Field label="Department"><NativeSelect name="departmentId" options={depts.map((d) => ({ value: d.id, label: d.name }))} value={deptId} placeholder="All departments" /></Field>
          <Field label="Assign to"><NativeSelect name="assigneeId" options={people.map((u) => ({ value: u.id, label: u.name }))} placeholder="Leave unassigned" /></Field>
          <Button>Create work orders</Button>
          <p className="w-full text-xs text-muted">One job per scheduled visit that doesn&apos;t have one yet, with the device type&apos;s PPM checklist. Completing the job completes the visit.</p>
        </ActionForm>
      </Panel>}
      {canMaint && <Panel title="Generate scheduled PPM visits">
        <ActionForm action={generatePpmAction} className="flex flex-wrap items-end gap-3">
          <Field label="From"><Input type="date" name="from" defaultValue={today} required /></Field>
          <Field label="To"><Input type="date" name="to" defaultValue={endOfMonth(addMonths(today, 2))} required /></Field>
          <Field label="Department"><NativeSelect name="departmentId" options={depts.map((d) => ({ value: d.id, label: d.name }))} value={deptId} placeholder="All departments" /></Field>
          <Button>Generate schedule</Button>
          <p className="w-full text-xs text-muted">Creates one scheduled PPM per asset per due date in the window (overdue assets get a visit on the first day). Months that already have a PPM are skipped.</p>
        </ActionForm>
      </Panel>}
      <form action="/assets/maintenance" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="tab" value="schedule" />
        {deptId && <input type="hidden" name="departmentId" value={deptId} />}
        <Field label="Show from"><Input type="date" name="from" defaultValue={from} /></Field>
        <Field label="to"><Input type="date" name="to" defaultValue={to} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
      {months.length === 0 ? <EmptyState title="No maintenance in this window">{canMaint ? "Generate a schedule above, or widen the date range." : "Widen the date range to see more."}</EmptyState> : months.map((m) => {
        const counts = m.items.reduce<Record<string, number>>((acc, e) => { const s = displayEventStatus(e, today); acc[s] = (acc[s] ?? 0) + 1; return acc; }, {});
        return (
          <Panel key={m.month} padded={false} title={<>{monthLabel(m.month)} <span className="ml-2 text-sm font-normal text-muted">{m.items.length} events</span></>}
            actions={<span className="flex flex-wrap gap-1">{Object.entries(counts).map(([s, n]) => <Badge key={s} tone={s === "OVERDUE" ? "danger" : s === "COMPLETED" ? "ok" : s === "IN_PROGRESS" ? "warn" : "info"}>{n} {humanize(s).toLowerCase()}</Badge>)}</span>}>
            <ul className="divide-y divide-line">
              {m.items.map((e) => {
                const st = displayEventStatus(e, today);
                return (
                  <li key={e.id} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 px-4 py-2 text-sm sm:grid-cols-[6.5rem_9rem_1fr_8rem_auto]">
                    <span className="whitespace-nowrap">{formatDate(e.completedDate ?? e.scheduledDate)}</span>
                    <Link href={`/assets/${e.assetId}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{e.tag}</Link>
                    <span className="hidden min-w-0 truncate sm:block">{maintenanceTypeLabel(e.type)} · {e.typeName}<span className="text-muted"> · {e.departmentName ?? "—"} {e.roomCode ?? ""}</span></span>
                    <span className="hidden sm:block"><StatusBadge value={st} /></span>
                    <span className="flex items-center justify-end gap-3 text-right">
                      {e.woId ? <Link href={`/assets/work-orders/${e.woId}`} className="font-mono text-[13px] text-primary hover:underline">{e.woNumber}</Link>
                        : canMaint && st !== "COMPLETED" && st !== "CANCELLED" && (
                          <ActionForm action={createPpmWorkOrdersAction} className="inline">
                            <input type="hidden" name="eventIds" value={e.id} />
                            <button className="text-primary hover:underline">Create job</button>
                          </ActionForm>)}
                      {!e.woId && canMaint && st !== "COMPLETED" && st !== "CANCELLED"
                        ? <Link href={`${returnPath}&from=${from}&to=${to}&complete=${e.id}#complete`} className="font-semibold text-primary hover:underline">Complete</Link>
                        : !e.woId && <span className="text-xs text-muted">{e.performedBy ?? ""}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function WarrantyTab({ rows, today }: { rows: { id: number; tag: string; typeName: string; manufacturer: string | null; model: string | null; departmentName: string | null; warrantyEnd: string | null }[]; today: string }) {
  const soon = rows.filter((r) => warrantyState(r.warrantyEnd, today).state === "EXPIRING").sort((a, b) => (a.warrantyEnd ?? "").localeCompare(b.warrantyEnd ?? ""));
  const recent = rows.filter((r) => { const w = warrantyState(r.warrantyEnd, today); return w.state === "EXPIRED" && (w.days ?? 0) >= -90; })
    .sort((a, b) => (b.warrantyEnd ?? "").localeCompare(a.warrantyEnd ?? ""));
  const table = (list: typeof rows, expired: boolean) => (
    <div className="overflow-x-auto"><table className="w-full text-[14px]">
      <thead className="bg-sunken text-left text-[13px] text-muted"><tr><th className="px-4 py-2 font-semibold">Asset</th><th className="px-4 py-2 font-semibold">Make / model</th><th className="px-4 py-2 font-semibold">Department</th><th className="px-4 py-2 font-semibold">Warranty end</th></tr></thead>
      <tbody>{list.map((r) => {
        const w = warrantyState(r.warrantyEnd, today);
        return (
          <tr key={r.id} className="border-t border-line">
            <td className="px-4 py-2"><Link href={`/assets/${r.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{r.tag}</Link><div className="text-xs text-muted">{r.typeName}</div></td>
            <td className="px-4 py-2">{[r.manufacturer, r.model].filter(Boolean).join(" ") || "—"}</td>
            <td className="px-4 py-2">{r.departmentName ?? "—"}</td>
            <td className="whitespace-nowrap px-4 py-2">{formatDate(r.warrantyEnd)} <Badge tone={expired ? "neutral" : (w.days ?? 0) <= 30 ? "danger" : "warn"}>{expired ? `${-(w.days ?? 0)} days ago` : `${w.days} days left`}</Badge></td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
  return (
    <div className="space-y-5">
      <Panel title={`Ending in the next 90 days (${soon.length})`} padded={false}
        actions={<Link href="/assets?warranty=expiring" className="text-sm text-primary hover:underline">Open in register</Link>}>
        {soon.length ? table(soon, false) : <p className="p-4 text-sm text-muted">No warranties end in the next 90 days.</p>}
      </Panel>
      <Panel title={`Ended in the last 90 days (${recent.length})`} padded={false}>
        {recent.length ? table(recent, true) : <p className="p-4 text-sm text-muted">None ended recently.</p>}
        <p className="border-t border-line px-4 py-2 text-xs text-muted">Consider a service contract for critical equipment out of warranty.</p>
      </Panel>
    </div>
  );
}

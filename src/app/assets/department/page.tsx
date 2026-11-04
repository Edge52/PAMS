import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, departments, deviceTypes, equipmentRequests, facilities, maintenanceEvents, rooms, workOrders } from "@/db/schema";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Panel, Stat, StatusBadge, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { DeviceTypeSelect, NativeSelect, Notice } from "@/components/assets/bits";
import { scopeWhere, scopedFacilityId } from "@/lib/assets/access";
import { lifecycle } from "@/lib/assets/maintenance";
import { deviceTypeOptions } from "@/lib/assets/queries";
import { ACTIVE_STATUSES } from "@/lib/assets/work-orders";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { addDaysISO, formatDate, formatNumber, todayISO } from "@/lib/format";
import { createRequestAction } from "../requests/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Department" };

/** A department head's page (wave 12, D9): their equipment, open jobs, upcoming maintenance, old devices, requests. */
export default async function DepartmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name }).from(facilities).where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  const facilityId = scopedFacilityId(scope, Number(sp.facilityId) || undefined) ?? facs[0]?.id;
  if (!facilityId) return <><PageHeader title="Department" /><EmptyState title="No hospital linked to your account">Ask an administrator for access to a hospital.</EmptyState></>;
  const depts = await db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name));
  const deptId = Number(sp.departmentId) || null;
  const dept = depts.find((d) => d.id === deptId) ?? null;
  const today = todayISO();
  const canRequest = me.role === "DEPARTMENT_HEAD" || can(me.role, "assets.edit") || can(me.role, "boq.edit");
  const header = (
    <>
      <PageHeader title={dept ? dept.name : "Department"} description="Your department's equipment, open jobs, maintenance coming up, devices past their service life, and equipment requests." />
      <Notice sp={sp} />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Hospital"><NativeSelect name="facilityId" value={facilityId} options={facs.map((f) => ({ value: f.id, label: f.name }))} /></Field>
        <Field label="Department"><NativeSelect name="departmentId" value={deptId} placeholder="Choose…" options={depts.map((d) => ({ value: d.id, label: d.name }))} /></Field>
        <Button variant="secondary">Show</Button>
      </form>
    </>
  );
  if (!dept) return <>{header}<EmptyState title="Choose your department">Pick it above to see its equipment and requests.</EmptyState></>;

  const kit = await db.select({ id: assets.id, tag: assets.assetTag, status: assets.status, typeName: deviceTypes.name, room: rooms.name, installDate: sql<string | null>`coalesce(${assets.installDate}, ${assets.purchaseDate})`, life: sql<number | null>`coalesce(${assets.lifeExpectancyYears}, ${deviceTypes.lifeExpectancyYears})` })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).leftJoin(rooms, eq(rooms.id, assets.roomId))
    .where(and(eq(assets.facilityId, facilityId), eq(assets.departmentId, dept.id), sql`${assets.status} <> 'DISPOSED'`)).orderBy(asc(deviceTypes.name));
  const ids = kit.map((k) => k.id);
  const [jobs, ppm, reqs] = await Promise.all([
    ids.length ? db.select({ id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status, priority: workOrders.priority, assetId: workOrders.assetId, reportedAt: workOrders.reportedAt })
      .from(workOrders).where(and(inArray(workOrders.assetId, ids), inArray(workOrders.status, [...ACTIVE_STATUSES]))).orderBy(desc(workOrders.reportedAt)) : [],
    ids.length ? db.select({ assetId: maintenanceEvents.assetId, date: maintenanceEvents.scheduledDate }).from(maintenanceEvents)
      .where(and(inArray(maintenanceEvents.assetId, ids), eq(maintenanceEvents.status, "SCHEDULED"), gte(maintenanceEvents.scheduledDate, today), lte(maintenanceEvents.scheduledDate, addDaysISO(today, 30)))).orderBy(asc(maintenanceEvents.scheduledDate)) : [],
    db.select({ r: equipmentRequests, typeName: deviceTypes.name }).from(equipmentRequests).innerJoin(deviceTypes, eq(deviceTypes.id, equipmentRequests.deviceTypeId))
      .where(eq(equipmentRequests.departmentId, dept.id)).orderBy(desc(equipmentRequests.id)).limit(20),
  ]);
  const tagOf = new Map(kit.map((k) => [k.id, k]));
  const old = kit.map((k) => ({ ...k, l: lifecycle(k.installDate, k.life, today) })).filter((k) => k.l.pctUsed != null && k.l.pctUsed >= 100).sort((a, b) => (b.l.pctUsed ?? 0) - (a.l.pctUsed ?? 0));
  const down = kit.filter((k) => k.status === "OUT_OF_SERVICE" || k.status === "UNDER_MAINTENANCE").length;
  const byType = Object.entries(kit.reduce((m, k) => { m[k.typeName] = (m[k.typeName] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {header}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Devices" value={formatNumber(kit.length)} hint={`${byType.length} kinds`} href={`/assets?facilityId=${facilityId}&departmentId=${dept.id}`} />
        <Stat label="Out of use now" value={formatNumber(down)} />
        <Stat label="Open jobs" value={formatNumber(jobs.length)} />
        <Stat label="Past service life" value={formatNumber(old.length)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Open jobs">
          {jobs.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="space-y-1.5 text-sm">{jobs.map((j) => <li key={j.id}><Link href={`/assets/work-orders/${j.id}`} className="font-mono text-primary hover:underline">{j.number}</Link> {j.title} <span className="text-muted">· {tagOf.get(j.assetId)?.tag}</span> <StatusBadge value={j.status} /></li>)}</ul>}
        </Panel>
        <Panel title="Maintenance in the next 30 days">
          {ppm.length === 0 ? <p className="text-sm text-muted">None scheduled.</p> : <ul className="space-y-1 text-sm">{ppm.map((p, i) => <li key={i}>{formatDate(p.date)} · <Link href={`/assets/${p.assetId}`} className="font-mono text-primary hover:underline">{tagOf.get(p.assetId)?.tag}</Link> <span className="text-muted">{tagOf.get(p.assetId)?.typeName}</span></li>)}</ul>}
        </Panel>
        <Panel title="Past service life">
          {old.length === 0 ? <p className="text-sm text-muted">None.</p> : <ul className="space-y-1 text-sm">{old.slice(0, 15).map((k) => <li key={k.id}><Link href={`/assets/${k.id}`} className="font-mono text-primary hover:underline">{k.tag}</Link> {k.typeName} <Badge tone="warn">{Math.round(k.l.pctUsed!)} % of life</Badge></li>)}</ul>}
        </Panel>
        <Panel title="Requests" actions={<Link href={`/assets/requests?facilityId=${facilityId}`} className="text-sm text-primary hover:underline">All requests</Link>}>
          {reqs.length === 0 ? <p className="mb-3 text-sm text-muted">No requests yet.</p> : <ul className="mb-3 space-y-1 text-sm">{reqs.map((x) => <li key={x.r.id}><b>{x.r.number}</b> {x.r.quantity} × {x.typeName} <StatusBadge value={x.r.status} />{x.r.planYear ? <span className="text-muted"> · {x.r.planYear}</span> : null}</li>)}</ul>}
          {canRequest && (
            <ActionForm action={createRequestAction} className="space-y-2 border-t border-line pt-3">
              <input type="hidden" name="facilityId" value={facilityId} /><input type="hidden" name="departmentId" value={dept.id} />
              <Field label="Equipment"><DeviceTypeSelect types={await deviceTypeOptions()} required /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Quantity"><Input type="number" name="quantity" min={1} max={500} defaultValue={1} /></Field>
                <Field label="Priority"><NativeSelect name="priority" value="NORMAL" options={[{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }]} /></Field>
                <Field label="Needed by"><Input type="date" name="neededBy" /></Field>
              </div>
              <Field label="Replaces (tag, optional)"><Input name="replaces" placeholder={old[0]?.tag ?? "e.g. LPH-MON-000123"} className="uppercase" /></Field>
              <Field label="Why it's needed"><Textarea name="reason" rows={3} required /></Field>
              <Button>Send request</Button>
            </ActionForm>
          )}
        </Panel>
      </div>
    </>
  );
}

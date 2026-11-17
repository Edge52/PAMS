import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Badge, Button, Field, FormGrid, Input, PageHeader, Panel, Stat, TabLinks, Textarea } from "@/components/ui";
import { UnsavedGuard } from "@/components/ui/unsaved-guard";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, NativeSelect, Notice } from "@/components/assets/bits";
import { CommissioningCurve, CommissioningGantt } from "@/components/assets/commissioning-charts";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { curve, deviceCounts, ganttRows, planWeeks, roomsOn, STAGES, type RoomState } from "@/lib/assets/commissioning";
import { pageOf, PLAN_TABS, type PlanTab } from "@/lib/assets/commissioning-view";
import { awaitingByDepartment, loadPlan, planOf, planRooms } from "@/lib/assets/commissioning-server";
import { formatDate } from "@/lib/format";
import { bulkDatesAction, deletePlanAction, saveRoomsAction, updatePlanAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commissioning plan" };

const TONE = ["neutral", "warn", "info", "ok"] as const;
function StageBadge({ s }: { s: RoomState }) {
  return <span className="inline-flex flex-wrap gap-1"><Badge tone={TONE[s.actualStage]}>{STAGES[s.actualStage]}</Badge>{s.late && <Badge tone="danger">Late: plan says {STAGES[s.plannedStage].toLowerCase()}</Badge>}</span>;
}

export default async function CommissioningPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const sp = await searchParams;
  const row = await loadPlan(id);
  if (!row) notFound();
  const { plan } = row;
  await requireFacilityAccess(plan.facilityId, me);
  const mayEdit = can(me.role, "facilities.edit");
  const today = new Date().toISOString().slice(0, 10);
  const p = planOf(plan);
  const rooms = await planRooms(id, plan.startsOn);
  const states = roomsOn(rooms, p, today, today);
  const weeks = planWeeks(rooms, p, today);
  const gantt = ganttRows(rooms, p, today);
  const devices = deviceCounts(rooms, today);
  const awaitingDept = await awaitingByDepartment(plan.projectId);
  // Devices on order belong to a department, not a floor: shown on its first row.
  const awaiting = new Map<string, number>();
  for (const [dept, n] of awaitingDept) { const r = gantt.find((g) => (Number(g.key.split("|")[2]) || null) === dept); if (r) awaiting.set(r.key, (awaiting.get(r.key) ?? 0) + n); }
  const onOrder = [...awaitingDept.values()].reduce((a, b) => a + b, 0);
  const at = (n: number) => states.filter((s) => s.actualStage >= n).length;
  const late = states.filter((s) => s.late).length;

  const floorsIn = [...new Map(rooms.map((r) => [r.floorId, { id: r.floorId, name: r.floor, level: r.level }])).values()].sort((a, b) => a.level - b.level);
  const deptsIn = [...new Map(rooms.filter((r) => r.departmentId != null).map((r) => [r.departmentId!, r.department ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const floorParam = Number(typeof sp.floorId === "string" ? sp.floorId : NaN);
  const floorSel = floorsIn.find((f) => f.id === floorParam) ?? floorsIn[0] ?? null;
  // Wave 27: one part of the plan on screen at a time (tabs), and the room table a page of rooms at a time.
  const tabs = PLAN_TABS.filter((t) => mayEdit || !t.edit);
  const tab: PlanTab = tabs.find((t) => t.key === sp.tab)?.key ?? (typeof sp.floorId === "string" ? "rooms" : "overview");
  const onFloor = states.filter((s) => s.room.floorId === floorSel?.id);
  const deptsOnFloor = [...new Map(onFloor.map((s) => [s.room.departmentId ?? 0, s.room.department ?? "No department"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const deptParam = Number(typeof sp.dept === "string" ? sp.dept : NaN);
  const deptSel = deptsOnFloor.some(([d]) => d === deptParam) ? deptParam : null;
  const inDept = deptSel == null ? onFloor : onFloor.filter((s) => (s.room.departmentId ?? 0) === deptSel);
  const pg = pageOf(inDept.length, Number(typeof sp.page === "string" ? sp.page : 1));
  const shown = inDept.slice(pg.from, pg.to);
  const roomsLink = (o: { floorId?: number; dept?: number | null; page?: number }) => {
    const q = new URLSearchParams({ tab: "rooms" });
    const f = o.floorId ?? floorSel?.id; if (f) q.set("floorId", String(f));
    const d = "dept" in o ? o.dept : deptSel; if (d != null) q.set("dept", String(d));
    if (o.page && o.page > 1) q.set("page", String(o.page));
    return `?${q}#rooms`;
  };
  const projs = mayEdit ? await db.select({ id: projects.id, code: projects.code, title: projects.title }).from(projects)
    .where(or(eq(projects.facilityId, plan.facilityId), isNull(projects.facilityId))).orderBy(asc(projects.code)) : [];

  return (
    <>
      <Crumbs items={[{ label: "Commissioning", href: "/assets/commissioning" }, { label: plan.name }]} />
      <PageHeader title={plan.name}
        description={<>{row.facility}{row.project ? <> · project <Link href={`/procurement/${plan.projectId}?tab=commissioning`} className="text-primary hover:underline">{row.project}</Link></> : null} · first handovers {formatDate(plan.startsOn)} · {plan.installWeeks} week{plan.installWeeks === 1 ? "" : "s"} to install, {plan.acceptWeeks} to accept</>}
        actions={<Link href={`/assets/3d?facilityId=${plan.facilityId}&commissioning=${id}`} className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas">Week by week in 3D</Link>} />
      <Notice sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rooms" value={rooms.length} />
        <Stat label="Handed over" value={at(1)} />
        <Stat label="Installed" value={at(2)} />
        <Stat label="Accepted" value={at(3)} />
        <Stat label="Behind plan" value={late ? <span className="text-danger">{late}</span> : 0} />
        <Stat label="Devices installed" value={`${devices.installed}/${devices.total}`} hint={`${devices.accepted} accepted${onOrder ? ` · ${onOrder} still on order` : ""}`} />
      </div>
      <TabLinks active={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: t.key === "rooms" ? roomsLink({}).replace("#rooms", "") : `?tab=${t.key}` }))} />
      {mayEdit && <UnsavedGuard />}

      {tab === "overview" && (rooms.length === 0 ? <p className="text-sm text-muted">The plan has no rooms left.</p> : (<>
        <Panel title="Progress by week" className="mb-5"><CommissioningCurve points={curve(rooms, p, weeks, today)} total={rooms.length} today={today} /></Panel>
        <Panel title="Gantt by floor and department" className="mb-5">
          <CommissioningGantt rows={gantt} weeks={weeks} today={today} awaiting={awaiting} roomsHref={(r) => roomsLink({ floorId: Number(r.key.split("|")[1]), dept: Number(r.key.split("|")[2]) || 0 })} />
          <p className="mt-2 text-xs text-muted">Accepted counts rooms whose every device has a signed acceptance (Assets › a device › Acceptance). Installation counts once the room&apos;s handover is recorded. A room with no devices registered stays at handed over unless it is marked as needing none.</p>
        </Panel>
      </>))}

      {tab === "dates" && mayEdit && (rooms.length === 0 ? <p className="text-sm text-muted">The plan has no rooms left.</p> : (
        <Panel title="Set a date for a group of rooms" className="mb-5">
          <form action={bulkDatesAction} className="flex flex-wrap items-end gap-3" data-unsaved-guard>
            <input type="hidden" name="planId" value={id} />
            <Field label="Rooms"><NativeSelect name="scope" value={floorSel ? `floor:${floorSel.id}` : "all"} options={[{ value: "all", label: "Every room in the plan" },
              ...floorsIn.map((f) => ({ value: `floor:${f.id}`, label: `Floor: ${f.name}` })), ...deptsIn.map(([d, n]) => ({ value: `dept:${d}`, label: `Department: ${n}` }))]} /></Field>
            <Field label="Date"><NativeSelect name="field" value="handoverPlanned" options={[{ value: "handoverPlanned", label: "Planned handover" }, { value: "handoverOn", label: "Actual handover" },
              { value: "installPlanned", label: "Planned installed (instead of handover + weeks)" }, { value: "acceptPlanned", label: "Planned accepted (instead of installed + weeks)" }]} /></Field>
            <Field label="Day" hint="Empty clears it"><Input type="date" name="date" /></Field>
            <Button variant="secondary">Set it</Button>
          </form>
        </Panel>
      ))}

      {tab === "rooms" && (rooms.length === 0 || !floorSel ? <p className="text-sm text-muted">The plan has no rooms left.</p> : (
        <Panel title={`Rooms on ${floorSel.name}`}>
          <div id="rooms" />
          {floorsIn.length > 1 && (
            <nav aria-label="Floors" className="mb-3 flex flex-wrap gap-2 text-sm">
              {floorsIn.map((f) => <Link key={f.id} href={roomsLink({ floorId: f.id, dept: null })} aria-current={f.id === floorSel.id ? "page" : undefined} className={`inline-flex min-h-8 items-center rounded-full border px-3 ${f.id === floorSel.id ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-sunken"}`}>{f.name} ({states.filter((s) => s.room.floorId === f.id).length})</Link>)}
            </nav>
          )}
          {deptsOnFloor.length > 1 && (
            <nav aria-label="Departments" className="mb-3 flex flex-wrap gap-2 text-sm">
              <Link href={roomsLink({ dept: null })} aria-current={deptSel == null ? "page" : undefined} className={`inline-flex min-h-8 items-center rounded-full border px-3 ${deptSel == null ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-sunken"}`}>Every department ({onFloor.length})</Link>
              {deptsOnFloor.map(([d, n]) => <Link key={d} href={roomsLink({ dept: d })} aria-current={d === deptSel ? "page" : undefined} className={`inline-flex min-h-8 items-center rounded-full border px-3 ${d === deptSel ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-sunken"}`}>{n} ({onFloor.filter((s) => (s.room.departmentId ?? 0) === d).length})</Link>)}
            </nav>
          )}
          <form action={saveRoomsAction} data-unsaved-guard>
            <input type="hidden" name="planId" value={id} /><input type="hidden" name="floorId" value={floorSel.id} />
            {deptSel != null && <input type="hidden" name="dept" value={deptSel} />}
            {pg.page > 1 && <input type="hidden" name="page" value={pg.page} />}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-sunken text-left text-xs text-muted"><tr>
                  <th className="px-2 py-2">Room</th><th className="px-2">Devices</th><th className="px-2">Handover planned</th><th className="px-2">Handed over</th>
                  <th className="px-2">Installed (plan · actual)</th><th className="px-2">Accepted (plan · actual)</th><th className="px-2">Now</th>
                  {mayEdit && <><th className="px-2">No equipment</th><th className="px-2">Leave out</th></>}
                </tr></thead>
                <tbody>{shown.map((s) => { const r = s.room, n = r.devices.length; return (
                  <tr key={r.roomId} className="border-t border-line align-top">
                    <td className="px-2 py-1.5"><Link href={`/facilities/${plan.facilityId}/rooms/${r.roomId}/sheet`} className="text-primary hover:underline">{r.name}</Link><span className="block font-mono text-xs text-muted">{r.code}{r.department ? ` · ${r.department}` : ""}</span></td>
                    <td className="px-2 text-xs">{n ? <Link href={`/assets?roomId=${r.roomId}`} className="hover:underline">{r.devices.filter((d) => d.installedOn).length}/{n} installed<br />{r.devices.filter((d) => d.acceptedOn).length}/{n} accepted</Link> : <span className="text-muted">none registered</span>}</td>
                    <td className="px-2">{mayEdit ? <><input type="hidden" name="roomId" value={r.roomId} /><Input type="date" name={`h_${r.roomId}`} defaultValue={r.handoverPlanned ?? ""} aria-label={`Planned handover, ${r.name}`} className="w-36" /></> : r.handoverPlanned ? formatDate(r.handoverPlanned) : "—"}</td>
                    <td className="px-2">{mayEdit ? <Input type="date" name={`o_${r.roomId}`} defaultValue={r.handoverOn ?? ""} aria-label={`Handed over, ${r.name}`} className="w-36" /> : r.handoverOn ? formatDate(r.handoverOn) : "—"}</td>
                    <td className="px-2 text-xs">{s.planned.installed ? formatDate(s.planned.installed) : "—"} · {s.actual.installed ? <b>{formatDate(s.actual.installed)}</b> : "—"}</td>
                    <td className="px-2 text-xs">{s.planned.accepted ? formatDate(s.planned.accepted) : "—"} · {s.actual.accepted ? <b>{formatDate(s.actual.accepted)}</b> : "—"}</td>
                    <td className="px-2"><StageBadge s={s} /></td>
                    {mayEdit && <>
                      <td className="px-2 text-center"><input type="checkbox" name={`n_${r.roomId}`} defaultChecked={r.noEquipment} aria-label={`${r.name} needs no equipment`} className="size-6" /></td>
                      <td className="px-2 text-center"><input type="checkbox" name={`x_${r.roomId}`} aria-label={`Leave ${r.name} out of the plan`} className="size-6" /></td>
                    </>}
                  </tr>
                ); })}</tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {mayEdit && <Button>Save these {shown.length} room{shown.length === 1 ? "" : "s"}</Button>}
              {pg.pages > 1 && (
                <nav aria-label="Pages of rooms" className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">Rooms {pg.from + 1}–{pg.to} of {inDept.length}</span>
                  {Array.from({ length: pg.pages }, (_, i) => i + 1).map((n) => (
                    <Link key={n} href={roomsLink({ page: n })} aria-current={n === pg.page ? "page" : undefined} aria-label={`Page ${n}`}
                      className={`inline-flex size-8 items-center justify-center rounded-full border ${n === pg.page ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-sunken"}`}>{n}</Link>
                  ))}
                </nav>
              )}
            </div>
            {mayEdit && pg.pages > 1 && <p className="mt-2 text-xs text-muted">Save before moving to another page: only the rooms on this page are saved.</p>}
          </form>
        </Panel>
      ))}

      {tab === "settings" && mayEdit && (
        <Panel>
          <div data-unsaved-guard><ActionForm action={updatePlanAction}>
            <input type="hidden" name="planId" value={id} />
            <FormGrid cols={3}>
              <Field label="Name"><Input name="name" required maxLength={160} defaultValue={plan.name} /></Field>
              <Field label="Project"><NativeSelect name="projectId" value={plan.projectId ?? ""} placeholder="None" options={projs.map((x) => ({ value: x.id, label: `${x.code} — ${x.title}` }))} /></Field>
              <Field label="First handovers"><Input type="date" name="startsOn" required defaultValue={plan.startsOn} /></Field>
              <Field label="Weeks from handover to installed"><Input name="installWeeks" inputMode="numeric" defaultValue={plan.installWeeks} /></Field>
              <Field label="Weeks from installed to accepted"><Input name="acceptWeeks" inputMode="numeric" defaultValue={plan.acceptWeeks} /></Field>
            </FormGrid>
            <Field label="Notes" className="mt-3"><Textarea name="notes" rows={2} defaultValue={plan.notes ?? ""} /></Field>
            <div className="mt-3"><Button>Save plan</Button></div>
          </ActionForm></div>
          <form action={deletePlanAction} className="mt-4 border-t border-line pt-3"><input type="hidden" name="planId" value={id} />
            <button className="inline-flex min-h-6 items-center text-sm text-danger hover:underline">Remove this plan</button> <span className="text-xs text-muted">Rooms, devices and acceptances are not touched.</span>
          </form>
        </Panel>
      )}
    </>
  );
}

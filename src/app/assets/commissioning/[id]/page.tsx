import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { Badge, Button, Field, FormGrid, Input, PageHeader, Panel, Stat, Textarea } from "@/components/ui";
import { ActionForm } from "@/components/assets/action-form";
import { Crumbs, NativeSelect, Notice } from "@/components/assets/bits";
import { CommissioningCurve, CommissioningGantt } from "@/components/assets/commissioning-charts";
import { can } from "@/lib/auth/permissions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { curve, deviceCounts, ganttRows, planWeeks, roomsOn, STAGES, type RoomState } from "@/lib/assets/commissioning";
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
  const shown = states.filter((s) => s.room.floorId === floorSel?.id);
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
      {rooms.length === 0 ? <p className="text-sm text-muted">The plan has no rooms left.</p> : (<>
        <Panel title="Progress by week" className="mb-5"><CommissioningCurve points={curve(rooms, p, weeks, today)} total={rooms.length} today={today} /></Panel>
        <Panel title="Gantt by floor and department" className="mb-5">
          <CommissioningGantt rows={gantt} weeks={weeks} today={today} awaiting={awaiting} roomsHref={(r) => `?floorId=${r.key.split("|")[1]}#rooms`} />
          <p className="mt-2 text-xs text-muted">Accepted counts rooms whose every device has a signed acceptance (Assets › a device › Acceptance). Installation counts once the room&apos;s handover is recorded. A room with no devices registered stays at handed over unless it is marked as needing none.</p>
        </Panel>
      </>)}

      {mayEdit && rooms.length > 0 && (
        <Panel title="Set a date for a group of rooms" className="mb-5">
          <form action={bulkDatesAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="planId" value={id} />
            <Field label="Rooms"><NativeSelect name="scope" value={floorSel ? `floor:${floorSel.id}` : "all"} options={[{ value: "all", label: "Every room in the plan" },
              ...floorsIn.map((f) => ({ value: `floor:${f.id}`, label: `Floor: ${f.name}` })), ...deptsIn.map(([d, n]) => ({ value: `dept:${d}`, label: `Department: ${n}` }))]} /></Field>
            <Field label="Date"><NativeSelect name="field" value="handoverPlanned" options={[{ value: "handoverPlanned", label: "Planned handover" }, { value: "handoverOn", label: "Actual handover" },
              { value: "installPlanned", label: "Planned installed (instead of handover + weeks)" }, { value: "acceptPlanned", label: "Planned accepted (instead of installed + weeks)" }]} /></Field>
            <Field label="Day" hint="Empty clears it"><Input type="date" name="date" /></Field>
            <Button variant="secondary">Set it</Button>
          </form>
        </Panel>
      )}

      {rooms.length > 0 && floorSel && (
        <Panel title={`Rooms on ${floorSel.name}`}>
          <div id="rooms" />
          {floorsIn.length > 1 && (
            <nav aria-label="Floors" className="mb-3 flex flex-wrap gap-2 text-sm">
              {floorsIn.map((f) => <Link key={f.id} href={`?floorId=${f.id}#rooms`} className={`rounded-full border px-3 py-1 ${f.id === floorSel.id ? "border-primary bg-primary-soft font-semibold" : "border-line hover:bg-sunken"}`}>{f.name} ({states.filter((s) => s.room.floorId === f.id).length})</Link>)}
            </nav>
          )}
          <form action={saveRoomsAction}>
            <input type="hidden" name="planId" value={id} /><input type="hidden" name="floorId" value={floorSel.id} />
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
                      <td className="px-2 text-center"><input type="checkbox" name={`n_${r.roomId}`} defaultChecked={r.noEquipment} aria-label={`${r.name} needs no equipment`} /></td>
                      <td className="px-2 text-center"><input type="checkbox" name={`x_${r.roomId}`} aria-label={`Leave ${r.name} out of the plan`} /></td>
                    </>}
                  </tr>
                ); })}</tbody>
              </table>
            </div>
            {mayEdit && <div className="mt-3"><Button>Save rooms on {floorSel.name}</Button></div>}
          </form>
        </Panel>
      )}

      {mayEdit && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold">Plan settings</summary>
          <Panel className="mt-3">
            <ActionForm action={updatePlanAction}>
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
            </ActionForm>
            <form action={deletePlanAction} className="mt-4 border-t border-line pt-3"><input type="hidden" name="planId" value={id} />
              <button className="text-sm text-danger hover:underline">Remove this plan</button> <span className="text-xs text-muted">Rooms, devices and acceptances are not touched.</span>
            </form>
          </Panel>
        </details>
      )}
    </>
  );
}

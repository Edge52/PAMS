/** Commissioning (wave 14, C5): the Gantt and progress of the commissioning plans linked to this project. */
import Link from "next/link";
import type { projects } from "@/db/schema";
import { EmptyState, LinkButton, Panel } from "@/components/ui";
import { CommissioningCurve, CommissioningGantt } from "@/components/assets/commissioning-charts";
import type { CurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { curve, ganttRows, planWeeks, roomsOn } from "@/lib/assets/commissioning";
import { awaitingByDepartment, listPlans, loadPlan, planOf, planRooms } from "@/lib/assets/commissioning-server";

type Project = typeof projects.$inferSelect;

export async function CommissioningTab({ project, me }: { project: Project; me: CurrentUser }) {
  const plans = await listPlans(null, project.id);
  const mayView = can(me.role, "assets.view");
  if (!plans.length) {
    return (
      <EmptyState title="No commissioning plan for this project"
        action={can(me.role, "facilities.edit") ? <LinkButton href={`/assets/commissioning${project.facilityId ? `?facilityId=${project.facilityId}` : ""}`} variant="primary">Make a commissioning plan</LinkButton> : undefined}>
        For a new building or wing: link a commissioning plan to this project to follow rooms from handover to accepted, and the devices still on order.
      </EmptyState>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const awaitingDept = await awaitingByDepartment(project.id);
  return (
    <div className="space-y-5">
      {await Promise.all(plans.map(async (pl) => {
        const row = await loadPlan(pl.id);
        if (!row) return null;
        const p = planOf(row.plan);
        const rooms = await planRooms(pl.id, row.plan.startsOn);
        const weeks = planWeeks(rooms, p, today);
        const gantt = ganttRows(rooms, p, today);
        const states = roomsOn(rooms, p, today, today);
        const awaiting = new Map<string, number>();
        for (const [dept, n] of awaitingDept) { const r = gantt.find((g) => (Number(g.key.split("|")[2]) || null) === dept); if (r) awaiting.set(r.key, (awaiting.get(r.key) ?? 0) + n); }
        const done = states.filter((s) => s.actualStage === 3).length, late = states.filter((s) => s.late).length;
        return (
          <Panel key={pl.id} title={<span>{pl.name} <span className="text-sm font-normal text-muted">· {pl.facility} · {done} of {rooms.length} rooms accepted{late ? `, ${late} behind plan` : ""}</span></span>}
            actions={mayView ? <Link href={`/assets/commissioning/${pl.id}`} className="text-sm font-semibold text-primary hover:underline">Open the plan</Link> : undefined}>
            <CommissioningCurve points={curve(rooms, p, weeks, today)} total={rooms.length} today={today} />
            <div className="mt-4"><CommissioningGantt rows={gantt} weeks={weeks} today={today} awaiting={awaiting} /></div>
          </Panel>
        );
      }))}
    </div>
  );
}

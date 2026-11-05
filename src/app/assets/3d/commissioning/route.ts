import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { inScope } from "@/lib/assets/access";
import { actualDates, plannedDates, planWeeks, type CommissioningPayload } from "@/lib/assets/commissioning";
import { loadPlan, planOf, planRooms } from "@/lib/assets/commissioning-server";

export const dynamic = "force-dynamic";

/** A commissioning plan for the 3D time slider (wave 14): each room's planned and actual dates. */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const me = await getCurrentUser();
  const id = Number(new URL(req.url).searchParams.get("planId"));
  if (!me || !Number.isInteger(id) || id <= 0) return new Response("Choose a plan.", { status: 400 });
  const row = await loadPlan(id);
  if (!row) return new Response("That plan isn't there.", { status: 404 });
  if (!inScope(await facilityScope(me), row.plan.facilityId)) return new Response("You don't have access to this facility.", { status: 403 });
  const p = planOf(row.plan);
  const today = new Date().toISOString().slice(0, 10);
  const rooms = await planRooms(id, row.plan.startsOn);
  const body: CommissioningPayload = {
    id, name: row.plan.name, facilityId: row.plan.facilityId, today, weeks: planWeeks(rooms, p, today),
    rooms: rooms.map((r) => { const a = plannedDates(r, p), b = actualDates(r); return [r.roomId, [a.handover, a.installed, a.accepted], [b.handover, b.installed, b.accepted]]; }),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

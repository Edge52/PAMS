import { routeGuard } from "@/lib/auth/route-guard";
import { can } from "@/lib/auth/permissions";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { inScope } from "@/lib/assets/access";
import { planVsInstalled } from "@/lib/assets/plan-installed-server";

export const dynamic = "force-dynamic";

/** Plan vs installed for the 3D view: one BOQ of the hospital against its asset register. */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const me = await getCurrentUser();
  if (!me || !can(me.role, "boq.view")) return new Response("You can't view BOQs.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const facilityId = Number(sp.get("facilityId")), boqId = Number(sp.get("boqId"));
  if (!Number.isInteger(facilityId) || facilityId <= 0 || !Number.isInteger(boqId) || boqId <= 0) return new Response("Choose a hospital and a BOQ.", { status: 400 });
  if (!inScope(await facilityScope(me), facilityId)) return new Response("You don't have access to this facility.", { status: 403 });
  const plan = await planVsInstalled(boqId, facilityId);
  if (!plan) return new Response("That BOQ isn't for this hospital.", { status: 404 });
  return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
}

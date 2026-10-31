import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { inScope } from "@/lib/assets/access";
import { twinLive } from "@/lib/assets/twin-live";

export const dynamic = "force-dynamic";

/** Live device status and trouble indicators for the 3D view (polled every minute). */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const id = Number(new URL(req.url).searchParams.get("facilityId"));
  if (!Number.isInteger(id) || id <= 0) return new Response("Choose a facility.", { status: 400 });
  if (!inScope(await facilityScope(await getCurrentUser()), id)) return new Response("You don't have access to this facility.", { status: 403 });
  return Response.json(await twinLive(id), { headers: { "Cache-Control": "no-store" } });
}

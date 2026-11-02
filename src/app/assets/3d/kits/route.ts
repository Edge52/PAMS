import { routeGuard } from "@/lib/auth/route-guard";
import { loadKits } from "@/lib/assets/room-kits";

export const dynamic = "force-dynamic";

/** The room kits the render uses (wave 7). */
export async function GET() {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  return Response.json((await loadKits()).kits, { headers: { "Cache-Control": "no-store" } });
}

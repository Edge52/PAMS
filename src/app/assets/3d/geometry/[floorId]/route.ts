import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";
import { facilityOfFloor, inScope } from "@/lib/assets/access";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { floorCad } from "@/db/schema";

export const dynamic = "force-dynamic";

/** CAD linework for one floor of the 3D view (walls, doors, glazing, columns in plan units). */
export async function GET(_req: Request, { params }: { params: Promise<{ floorId: string }> }) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const id = Number((await params).floorId);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const facilityId = await facilityOfFloor(id);
  if (facilityId == null) return new Response("Not found", { status: 404 });
  if (!inScope(await facilityScope(await getCurrentUser()), facilityId)) return new Response("You don't have access to this facility.", { status: 403 });
  const [g] = await db.select({ walls: floorCad.walls, doors: floorCad.doors, glass: floorCad.glass, columns: floorCad.columns })
    .from(floorCad).where(eq(floorCad.floorId, id));
  if (!g) return new Response("Not found", { status: 404 });
  return Response.json({ walls: g.walls ?? [], doors: g.doors ?? [], glass: g.glass ?? [], columns: g.columns ?? [] },
    { headers: { "Cache-Control": "private, max-age=300" } });
}

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, users, workOrders } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** A device's open jobs and those closed in the last 30 days, with their progress (wave 8, A9: follow a job in 3D). */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const assetId = Number(new URL(req.url).searchParams.get("assetId"));
  if (!Number.isInteger(assetId) || assetId <= 0) return Response.json([], { status: 400 });
  const [a] = await db.select({ facilityId: assets.facilityId }).from(assets).where(eq(assets.id, assetId));
  if (!a) return Response.json([], { status: 404 });
  const scope = await facilityScope(await getCurrentUser());
  if (scope && !scope.includes(a.facilityId)) return Response.json([], { status: 403 });
  const rows = await db.select({
    id: workOrders.id, number: workOrders.number, title: workOrders.title, status: workOrders.status, priority: workOrders.priority,
    reportedAt: workOrders.reportedAt, assignedAt: workOrders.assignedAt, startedAt: workOrders.startedAt, completedAt: workOrders.completedAt,
    dueAt: workOrders.dueAt, assignee: users.name,
  }).from(workOrders).leftJoin(users, eq(users.id, workOrders.assignedToId))
    .where(and(eq(workOrders.assetId, assetId), or(inArray(workOrders.status, ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"]), sql`${workOrders.completedAt} > now() - interval '30 days'`)))
    .orderBy(desc(workOrders.reportedAt)).limit(10);
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
}

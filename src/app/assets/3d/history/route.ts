import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetMovements, assets, deviceTypes, workOrders } from "@/db/schema";
import { routeGuard } from "@/lib/auth/route-guard";
import { facilityScope, getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export type HistoryEvent = { t: string; kind: "fault" | "repair" | "move" | "install"; assetId: number; roomId: number | null; text: string };

/**
 * Time slider (wave 7, step 7f): what happened in a hospital over the last N days, from the records that carry a
 * time — faults reported, jobs completed, moves and installations. Device status at a past moment is not stored, so it
 * isn't replayed.
 */
export async function GET(req: Request) {
  const denied = await routeGuard("assets.view");
  if (denied) return denied;
  const u = new URL(req.url);
  const fid = Number(u.searchParams.get("facilityId")); const days = Math.min(365, Math.max(1, Number(u.searchParams.get("days")) || 30));
  if (!Number.isInteger(fid) || fid <= 0) return Response.json({ error: "Choose a hospital" }, { status: 400 });
  const scope = await facilityScope(await getCurrentUser());
  if (scope && !scope.includes(fid)) return Response.json({ error: "You can't see this hospital." }, { status: 403 });
  const since = new Date(Date.now() - days * 86400_000);
  const [faults, repairs, moves, installs] = await Promise.all([
    db.select({ t: workOrders.reportedAt, assetId: workOrders.assetId, roomId: assets.roomId, title: workOrders.title, number: workOrders.number }).from(workOrders)
      .innerJoin(assets, eq(assets.id, workOrders.assetId)).where(and(eq(workOrders.facilityId, fid), gte(workOrders.reportedAt, since))),
    db.select({ t: workOrders.completedAt, assetId: workOrders.assetId, roomId: assets.roomId, title: workOrders.title, number: workOrders.number }).from(workOrders)
      .innerJoin(assets, eq(assets.id, workOrders.assetId)).where(and(eq(workOrders.facilityId, fid), gte(workOrders.completedAt, since))),
    db.select({ t: assetMovements.movedAt, assetId: assetMovements.assetId, roomId: assetMovements.toRoomId, by: assetMovements.movedBy }).from(assetMovements)
      .innerJoin(assets, eq(assets.id, assetMovements.assetId)).where(and(eq(assets.facilityId, fid), gte(assetMovements.movedAt, since))),
    db.select({ d: assets.installDate, assetId: assets.id, roomId: assets.roomId, type: deviceTypes.name }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(and(eq(assets.facilityId, fid), sql`${assets.installDate} >= ${since.toISOString().slice(0, 10)}::date`)),
  ]);
  const events: HistoryEvent[] = [
    ...faults.map((r) => ({ t: r.t.toISOString(), kind: "fault" as const, assetId: r.assetId, roomId: r.roomId, text: `${r.number} reported: ${r.title}` })),
    ...repairs.filter((r) => r.t).map((r) => ({ t: r.t!.toISOString(), kind: "repair" as const, assetId: r.assetId, roomId: r.roomId, text: `${r.number} done: ${r.title}` })),
    ...moves.map((r) => ({ t: r.t.toISOString(), kind: "move" as const, assetId: r.assetId, roomId: r.roomId, text: `Moved${r.by ? ` by ${r.by}` : ""}` })),
    ...installs.filter((r) => r.d).map((r) => ({ t: new Date(`${r.d}T09:00:00`).toISOString(), kind: "install" as const, assetId: r.assetId, roomId: r.roomId, text: `${r.type} installed` })),
  ].sort((a, b) => a.t.localeCompare(b.t)).slice(-5000);
  return Response.json({ since: since.toISOString(), until: new Date().toISOString(), events }, { headers: { "Cache-Control": "no-store" } });
}

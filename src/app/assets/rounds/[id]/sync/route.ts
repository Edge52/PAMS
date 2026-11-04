/**
 * Results from the rounds phone page (wave 12, D7). The page queues results while offline and sends them here when it
 * can; each is applied once (the same device again in the same round replaces the earlier result).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, roundItems, rooms, rounds, workOrders } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { moveAsset } from "@/lib/assets/mutations";
import { applyAssetEffect, coverForAsset, notifyAssigners } from "@/lib/assets/work-order-server";
import { responseDue, suggestedPriority } from "@/lib/assets/work-orders";
import { todayISO } from "@/lib/format";
import { logActivity, nextNumber } from "@/lib/server-utils";

const RESULTS = ["OK", "FAULT", "MOVED", "FOUND_ELSEWHERE"] as const;
type Item = { assetId?: number; tag?: string; result: (typeof RESULTS)[number]; roomId?: number | null; note?: string; checkedAt?: string };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("assets.move");
  const id = Number((await params).id);
  const [r] = await db.select().from(rounds).where(eq(rounds.id, id));
  if (!r) return Response.json({ error: "That round no longer exists." }, { status: 404 });
  await requireFacilityAccess(r.facilityId, me);
  if (r.finishedAt) return Response.json({ error: "This round is finished." }, { status: 409 });
  const body = (await req.json().catch(() => null)) as { items?: Item[] } | null;
  const items = Array.isArray(body?.items) ? body!.items.slice(0, 500) : [];
  const done: { key: string; ok: boolean; message: string; assetId?: number }[] = [];
  for (const it of items) {
    const key = `${it.assetId ?? it.tag}:${it.checkedAt ?? ""}`;
    if (!RESULTS.includes(it.result)) { done.push({ key, ok: false, message: "Unknown result." }); continue; }
    const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality, roomId: assets.roomId, departmentId: assets.departmentId, typeName: deviceTypes.name })
      .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
      .where(it.assetId ? eq(assets.id, it.assetId) : sql`upper(${assets.assetTag}) = ${String(it.tag ?? "").toUpperCase()}`);
    if (!a || a.facilityId !== r.facilityId) { done.push({ key, ok: false, message: `${it.tag ?? it.assetId}: not a device of this hospital.` }); continue; }
    const checkedAt = it.checkedAt && !Number.isNaN(Date.parse(it.checkedAt)) ? new Date(it.checkedAt) : new Date();
    const note = String(it.note ?? "").trim().slice(0, 500) || null;
    let result: (typeof RESULTS)[number] = it.result, workOrderId: number | null = null, roomId = it.roomId ?? a.roomId;
    if (result === "OK" && r.departmentId && a.departmentId !== r.departmentId) result = "FOUND_ELSEWHERE";
    if (result === "MOVED") {
      const [room] = it.roomId ? await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, it.roomId)) : [];
      if (!room) { done.push({ key, ok: false, message: `${a.tag}: choose the room it's in.` }); continue; }
      const m = await moveAsset({ assetId: a.id, toRoomId: room.id, reason: `Found during a ${r.kind === "STOCKTAKE" ? "stock-take" : "round"}`, movedBy: me.name });
      if (!m.ok) { done.push({ key, ok: false, message: `${a.tag}: ${m.error}` }); continue; }
      roomId = room.id;
    }
    if (result === "FAULT") {
      const [open] = await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.assetId, a.id), sql`${workOrders.status} in ('OPEN','ASSIGNED','IN_PROGRESS','ON_HOLD')`)).limit(1);
      if (open) workOrderId = open.id;
      else {
        const now = new Date(), priority = suggestedPriority(a.criticality, false), cover = await coverForAsset(a.id, todayISO(now));
        const wo = await db.transaction(async (tx) => {
          const number = await nextNumber("WO", workOrders, workOrders.number, tx);
          const [w] = await tx.insert(workOrders).values({ number, assetId: a.id, facilityId: a.facilityId, type: "CORRECTIVE", priority, status: "OPEN", title: (note ?? "Fault found on a round").slice(0, 200),
            reportedById: me.id, reportedByName: me.name, reportedAt: now, dueAt: responseDue(now, priority), coverage: cover.kind, contractId: cover.kind === "CONTRACT" ? cover.contract.id : null })
            .returning({ id: workOrders.id, number: workOrders.number, assetId: workOrders.assetId, deviceDown: workOrders.deviceDown });
          await logActivity("work_order", w.id, "reported", `Reported on a round by ${me.name}${note ? `: ${note}` : ""}`, me.name, tx);
          await applyAssetEffect("report", w, { actor: me.name }, tx);
          return w;
        });
        workOrderId = wo.id;
        await notifyAssigners(a.facilityId, me.id, { kind: "work_order_reported", title: `${wo.number}: fault on ${a.tag} found on a round`, body: note ?? a.typeName, href: `/assets/work-orders/${wo.id}`, dedupeKey: `wo_reported:${wo.id}` });
      }
    }
    await db.insert(roundItems).values({ roundId: id, assetId: a.id, result, roomId, note, workOrderId, checkedAt })
      .onConflictDoUpdate({ target: [roundItems.roundId, roundItems.assetId], set: { result, roomId, note, workOrderId, checkedAt } });
    done.push({ key, ok: true, assetId: a.id, message: `${a.tag}: ${result === "FAULT" ? "fault reported" : result === "MOVED" ? "moved" : result === "FOUND_ELSEWHERE" ? "belongs to another department; noted" : "OK"}` });
  }
  return Response.json({ done });
}

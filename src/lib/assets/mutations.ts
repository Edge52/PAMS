import "server-only";
/** Asset mutations shared by the asset detail page and the floor map (moves and pin positions). */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetMovements, assets, buildings, departments, floors, rooms } from "@/db/schema";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

export type MoveInput = {
  assetId: number;
  toRoomId: number | null;
  toDepartmentId?: number | null;
  posX?: number | null;
  posY?: number | null;
  reason?: string | null;
  movedBy?: string | null;
};

export type MoveResult = { ok: true; moved: boolean; summary: string } | { ok: false; error: string };

/**
 * Move an asset to a room (department follows the room) or to a department without a room.
 * Records asset_movements when the room or department changes; a same-room drop only updates the pin position.
 */
export async function moveAsset(input: MoveInput): Promise<MoveResult> {
  const [a] = await db.select().from(assets).where(eq(assets.id, input.assetId));
  if (!a) return { ok: false, error: "That asset no longer exists." };

  let toDept = input.toDepartmentId ?? null;
  let roomLabel: string | null = null;
  if (input.toRoomId) {
    const [r] = await db.select({ id: rooms.id, code: rooms.code, name: rooms.name, departmentId: rooms.departmentId, facilityId: buildings.facilityId })
      .from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId))
      .where(eq(rooms.id, input.toRoomId));
    if (!r) return { ok: false, error: "That room no longer exists." };
    if (r.facilityId !== a.facilityId) return { ok: false, error: "That room is in another facility. Assets can only move within their own facility." };
    toDept = r.departmentId ?? toDept;
    roomLabel = `${r.name} (${r.code})`;
  }
  if (!input.toRoomId && !toDept) return { ok: false, error: "Choose a room or a department." };
  if (toDept) {
    const [d] = await db.select({ facilityId: departments.facilityId }).from(departments).where(eq(departments.id, toDept));
    if (!d) return { ok: false, error: "That department no longer exists." };
    if (d.facilityId !== a.facilityId) return { ok: false, error: "That department is in another facility. Assets can only move within their own facility." };
  }

  const roomChanged = (input.toRoomId ?? null) !== a.roomId;
  const deptChanged = toDept !== a.departmentId;
  const pos = roomChanged ? { posX: input.posX ?? null, posY: input.posY ?? null }
    : input.posX !== undefined ? { posX: input.posX ?? null, posY: input.posY ?? null } : {};

  if (!roomChanged && !deptChanged) {
    if (Object.keys(pos).length) {
      await db.update(assets).set(pos).where(eq(assets.id, a.id));
      return { ok: true, moved: false, summary: "Pin position saved." };
    }
    return { ok: true, moved: false, summary: "Nothing changed — the asset is already there." };
  }

  let deptLabel: string | null = null;
  if (toDept) {
    const [d] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, toDept));
    deptLabel = d?.name ?? null;
  }
  const installing = a.status === "IN_STOCK" && !!input.toRoomId;
  const status = installing ? "INSTALLED" : a.status;
  // First installation: record the date (it also starts the warranty clock for maintenance planning).
  const installDate = installing && !a.installDate ? todayISO() : a.installDate;
  await db.transaction(async (tx) => {
    await tx.update(assets).set({ roomId: input.toRoomId ?? null, departmentId: toDept, status, installDate, ...pos }).where(eq(assets.id, a.id));
    await tx.insert(assetMovements).values({
      assetId: a.id, fromRoomId: a.roomId, toRoomId: input.toRoomId ?? null, fromDepartmentId: a.departmentId, toDepartmentId: toDept,
      reason: input.reason ?? null, movedBy: input.movedBy ?? null,
    });
  });
  const where = roomLabel ?? deptLabel ?? "a new location";
  const summary = `Moved ${a.assetTag} to ${where}${input.reason ? ` — ${input.reason}` : ""}`;
  await logActivity("asset", a.id, "moved", summary); // records the signed-in user
  return { ok: true, moved: true, summary };
}

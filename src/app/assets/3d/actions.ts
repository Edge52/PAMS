"use server";
/**
 * Actions the 3D view calls without leaving the model. Each returns a result instead of redirecting, so the scene
 * can update in place. Permission first, then the asset's facility, then the shared move logic (lib/assets/mutations).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, rooms, twinViews } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { decodeView } from "@/components/assets/twin/view-state";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, reqId, text } from "@/lib/assets/forms";
import { moveAsset } from "@/lib/assets/mutations";
import { pointInPolygon, rectPoly, type Pt } from "@/components/assets/twin/geometry";

export type TwinActionState = { ok?: string; error?: string; assetId?: number; roomId?: number; posX?: number | null; posY?: number | null } | null;
export type SavedView = { id: number; name: string; state: string; shared: boolean; mine: boolean; by: string | null };
export type ViewActionState = { ok?: string; error?: string; view?: SavedView; deletedId?: number } | null;

async function loadAsset(assetId: number) {
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId, roomId: assets.roomId, status: assets.status }).from(assets).where(eq(assets.id, assetId));
  return a;
}

const MoveSchema = z.object({ assetId: reqId("Device"), roomId: reqId("Room"), reason: text(500) });

/** Move a device to another room from the 3D view. Its pin goes back to automatic placement in the new room. */
export async function twinMoveAction(_: TwinActionState, fd: FormData): Promise<TwinActionState> {
  const me = await requirePermission("assets.move");
  const p = MoveSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const a = await loadAsset(p.data.assetId);
  if (!a) return { error: "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: "A disposed device can't be moved." };
  if (a.roomId === p.data.roomId) return { error: "The device is already in that room." };
  const res = await moveAsset({ assetId: a.id, toRoomId: p.data.roomId, reason: p.data.reason ?? null, movedBy: me.name, posX: null, posY: null });
  if (!res.ok) return { error: res.error };
  revalidatePath(`/assets/${a.id}`);
  revalidatePath("/assets/map");
  return { ok: res.summary, assetId: a.id, roomId: p.data.roomId, posX: null, posY: null };
}

const PlaceSchema = z.object({
  assetId: reqId("Device"),
  posX: z.coerce.number({ error: "Click a spot in the room." }).finite(),
  posY: z.coerce.number({ error: "Click a spot in the room." }).finite(),
  clear: z.preprocess((v) => v === "1" || v === "true", z.boolean()).optional(),
});

/**
 * Save a device's exact spot inside its room (plan units, the same frame the 2D floor map uses), or clear it so the
 * device goes back to automatic placement. The spot must be inside the room's outline.
 */
export async function twinPlaceAction(_: TwinActionState, fd: FormData): Promise<TwinActionState> {
  const me = await requirePermission("assets.move");
  const p = PlaceSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const a = await loadAsset(p.data.assetId);
  if (!a) return { error: "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (!a.roomId) return { error: "The device isn't in a room yet. Move it to a room first." };
  if (p.data.clear) {
    await db.update(assets).set({ posX: null, posY: null }).where(eq(assets.id, a.id));
    revalidatePath("/assets/map");
    return { ok: "Back to automatic placement.", assetId: a.id, roomId: a.roomId, posX: null, posY: null };
  }
  const [r] = await db.select({ polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h }).from(rooms).where(eq(rooms.id, a.roomId));
  if (!r) return { error: "That room no longer exists." };
  const poly = (r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)) as Pt[];
  if (!pointInPolygon([p.data.posX, p.data.posY], poly)) return { error: "That spot is outside the device's room. Click inside the room, or move the device first." };
  const res = await moveAsset({ assetId: a.id, toRoomId: a.roomId, posX: Math.round(p.data.posX * 10) / 10, posY: Math.round(p.data.posY * 10) / 10 });
  if (!res.ok) return { error: res.error };
  revalidatePath("/assets/map");
  return { ok: "Exact spot saved. The 2D floor map shows it too.", assetId: a.id, roomId: a.roomId, posX: p.data.posX, posY: p.data.posY };
}

const ViewSchema = z.object({
  facilityId: reqId("Hospital"), name: z.string().trim().min(1, "Give the view a name.").max(80, "Keep the name under 80 characters."),
  state: z.string().max(2000), shared: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

/** Save the current camera, floor, layer and filters under a name. Anyone who can see the hospital may save views. */
export async function saveViewAction(_: ViewActionState, fd: FormData): Promise<ViewActionState> {
  const me = await requirePermission("assets.view");
  const p = ViewSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireFacilityAccess(p.data.facilityId, me);
  if (!decodeView(p.data.state)) return { error: "That view couldn't be read. Move the model a little and try again." };
  const [row] = await db.insert(twinViews).values({
    facilityId: p.data.facilityId, name: p.data.name, state: p.data.state, shared: p.data.shared, createdById: me.id, createdByName: me.name,
  }).returning({ id: twinViews.id });
  return { ok: `View “${p.data.name}” saved${p.data.shared ? " and shared" : ""}.`, view: { id: row.id, name: p.data.name, state: p.data.state, shared: p.data.shared, mine: true, by: me.name } };
}

/** Delete a saved view: its author, or an administrator for shared views. */
export async function deleteViewAction(_: ViewActionState, fd: FormData): Promise<ViewActionState> {
  const me = await requirePermission("assets.view");
  const id = Number(fd.get("viewId"));
  const [v] = Number.isInteger(id) ? await db.select().from(twinViews).where(eq(twinViews.id, id)) : [];
  if (!v) return { error: "That view no longer exists." };
  await requireFacilityAccess(v.facilityId, me);
  if (v.createdById !== me.id && !can(me.role, "users.manage")) return { error: "Only the person who saved this view can delete it." };
  await db.delete(twinViews).where(eq(twinViews.id, v.id));
  return { ok: `View “${v.name}” deleted.`, deletedId: v.id };
}

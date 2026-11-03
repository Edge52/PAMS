"use server";
/**
 * Actions the 3D view calls without leaving the model. Each returns a result instead of redirecting, so the scene
 * can update in place. Permission first, then the asset's facility, then the shared move logic (lib/assets/mutations).
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, buildings, documents, floors, rooms, routeFixes, twinNotes, twinTours, twinViews, users, type TourStop } from "@/db/schema";
import type { TwinFix, TwinRoom } from "@/components/assets/twin/types";
import { can } from "@/lib/auth/permissions";
import { decodeView } from "@/components/assets/twin/view-state";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, reqId, text } from "@/lib/assets/forms";
import { moveAsset } from "@/lib/assets/mutations";
import { notifyUsers } from "@/lib/notifications";
import { fileKind, storeFile } from "@/lib/storage";
import { noteOf, type TwinNote } from "@/lib/assets/twin-notes";
import { pointInPolygon, rectPoly, type Pt } from "@/components/assets/twin/geometry";

export type TwinActionState = { ok?: string; error?: string; assetId?: number; roomId?: number; posX?: number | null; posY?: number | null } | null;
export type SavedView = { id: number; name: string; state: string; shared: boolean; mine: boolean; by: string | null; render?: Record<string, unknown> | null };
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

export type DropActionState = { ok?: string; error?: string; assetId?: number; roomId?: number | null; posX?: number | null; posY?: number | null; rot?: number | null } | null;

const DropSchema = z.object({
  assetId: reqId("Device"),
  roomId: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().positive().nullable()),
  posX: z.coerce.number().finite().optional(), posY: z.coerce.number().finite().optional(),
  rot: z.coerce.number().finite().optional(),
});

/**
 * Drop a device on the plan from the 3D view (wave 7): its room, exact spot (plan units) and turn (degrees clockwise).
 * An empty room sends it back to the "To place" list (in store, no room). The spot must be inside the room.
 */
export async function twinDropAction(_: DropActionState, fd: FormData): Promise<DropActionState> {
  const me = await requirePermission("assets.move");
  const p = DropSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const a = await loadAsset(p.data.assetId);
  if (!a) return { error: "That device no longer exists." };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return { error: "A disposed device can't be placed." };
  if (p.data.roomId == null) {
    const res = await moveAsset({ assetId: a.id, toRoomId: null, reason: "Taken off the plan in the 3D view", movedBy: me.name, posX: null, posY: null });
    if (!res.ok) return { error: res.error };
    await db.update(assets).set({ posRot: null }).where(eq(assets.id, a.id));
    revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/map");
    return { ok: "Back on the “To place” list.", assetId: a.id, roomId: null, posX: null, posY: null, rot: null };
  }
  if (p.data.posX == null || p.data.posY == null) return { error: "Click a spot in a room." };
  const [r] = await db.select({ polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h, name: rooms.name }).from(rooms).where(eq(rooms.id, p.data.roomId));
  if (!r) return { error: "That room no longer exists." };
  const poly = (r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h)) as Pt[];
  if (!pointInPolygon([p.data.posX, p.data.posY], poly)) return { error: "Drop the device inside a room." };
  const posX = Math.round(p.data.posX * 10) / 10, posY = Math.round(p.data.posY * 10) / 10;
  const rot = p.data.rot != null ? ((Math.round(p.data.rot) % 360) + 360) % 360 : null;
  const res = await moveAsset({ assetId: a.id, toRoomId: p.data.roomId, posX, posY, reason: a.roomId === p.data.roomId ? undefined : "Placed in the 3D view", movedBy: me.name });
  if (!res.ok) return { error: res.error };
  await db.update(assets).set({ posRot: rot }).where(eq(assets.id, a.id));
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/map");
  return { ok: a.roomId === p.data.roomId ? `Moved within ${r.name}.` : `Placed in ${r.name}.`, assetId: a.id, roomId: p.data.roomId, posX, posY, rot };
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
  // Render settings (wave 7): only known keys with simple values are kept.
  let render: Record<string, unknown> | null = null;
  const raw = fd.get("render");
  if (typeof raw === "string" && raw) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const keys = ["floorId", "departmentId", "view", "cutHeight", "look", "kits", "labels", "titleBlock", "transparent", "size", "equipment", "boqId"];
      render = Object.fromEntries(Object.entries(o).filter(([k, v]) => keys.includes(k) && (v === null || ["number", "string", "boolean"].includes(typeof v)) && String(v).length <= 40));
    } catch { return { error: "The render settings couldn't be read." }; }
  }
  const [row] = await db.insert(twinViews).values({
    facilityId: p.data.facilityId, name: p.data.name, state: p.data.state, shared: p.data.shared, createdById: me.id, createdByName: me.name, render,
  }).returning({ id: twinViews.id });
  return { ok: `View “${p.data.name}” saved${p.data.shared ? " and shared" : ""}.`, view: { id: row.id, name: p.data.name, state: p.data.state, shared: p.data.shared, mine: true, by: me.name, render } };
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

/* ── Notes in the model (wave 7, step 7e) ── */

export type NoteActionState = { ok?: string; error?: string; note?: TwinNote; deletedId?: number } | null;

const NoteSchema = z.object({
  floorId: reqId("Floor"), roomId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  assetId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  x: z.coerce.number().finite(), y: z.coerce.number().finite(),
  text: z.string().trim().min(1, "Write the note.").max(2000, "Keep the note under 2,000 characters."),
  assigneeId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
});

/** Add a note on a room, a device or a spot. Anyone who can see the hospital may add notes. */
export async function addNoteAction(_: NoteActionState, fd: FormData): Promise<NoteActionState> {
  const me = await requirePermission("assets.view");
  const p = NoteSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [fl] = await db.select({ facilityId: buildings.facilityId }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.id, d.floorId));
  if (!fl) return { error: "That floor no longer exists." };
  await requireFacilityAccess(fl.facilityId, me);
  if (d.roomId) { const [r] = await db.select({ floorId: rooms.floorId }).from(rooms).where(eq(rooms.id, d.roomId)); if (r?.floorId !== d.floorId) return { error: "That room isn't on this floor." }; }
  if (d.assetId) { const a = await loadAsset(d.assetId); if (!a || a.facilityId !== fl.facilityId) return { error: "That device isn't in this hospital." }; }
  let assignee: { id: number; name: string } | undefined;
  if (d.assigneeId) { [assignee] = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, d.assigneeId), eq(users.active, true))); if (!assignee) return { error: "Choose someone from the list." }; }
  const [row] = await db.insert(twinNotes).values({
    facilityId: fl.facilityId, floorId: d.floorId, roomId: d.roomId ?? null, assetId: d.assetId ?? null, x: d.x, y: d.y, text: d.text,
    assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null, createdById: me.id, createdByName: me.name,
  }).returning();
  if (assignee && assignee.id !== me.id) {
    await notifyUsers([assignee.id], { kind: "twin_note", title: `${me.name} left you a note in the 3D view`.slice(0, 200), body: d.text.slice(0, 300), href: `/assets/3d?facilityId=${fl.facilityId}&note=${row.id}`, dedupeKey: `twin_note:${row.id}` });
  }
  return { ok: assignee ? `Note added for ${assignee.name}.` : "Note added.", note: noteOf(row) };
}

/** Close or reopen a note: its author, its assignee, or anyone who edits assets. */
export async function setNoteStatusAction(_: NoteActionState, fd: FormData): Promise<NoteActionState> {
  const me = await requirePermission("assets.view");
  const id = Number(fd.get("noteId")), done = fd.get("status") === "DONE";
  const [n] = Number.isInteger(id) ? await db.select().from(twinNotes).where(eq(twinNotes.id, id)) : [];
  if (!n) return { error: "That note no longer exists." };
  await requireFacilityAccess(n.facilityId, me);
  if (n.createdById !== me.id && n.assigneeId !== me.id && !can(me.role, "assets.edit")) return { error: "Only the note's author, the person it's for, or someone who edits assets can close it." };
  const [row] = await db.update(twinNotes).set(done ? { status: "DONE", closedAt: new Date(), closedByName: me.name } : { status: "OPEN", closedAt: null, closedByName: null })
    .where(eq(twinNotes.id, n.id)).returning();
  return { ok: done ? "Note closed." : "Note reopened.", note: noteOf(row) };
}

/** Delete a note: its author, or anyone who edits assets. */
export async function deleteNoteAction(_: NoteActionState, fd: FormData): Promise<NoteActionState> {
  const me = await requirePermission("assets.view");
  const id = Number(fd.get("noteId"));
  const [n] = Number.isInteger(id) ? await db.select().from(twinNotes).where(eq(twinNotes.id, id)) : [];
  if (!n) return { error: "That note no longer exists." };
  await requireFacilityAccess(n.facilityId, me);
  if (n.createdById !== me.id && !can(me.role, "assets.edit")) return { error: "Only the note's author or someone who edits assets can delete it." };
  await db.delete(twinNotes).where(eq(twinNotes.id, n.id));
  return { ok: "Note deleted.", deletedId: n.id };
}

/* ── Guided tours (wave 7, step 7f) ── */

export type Tour = { id: number; name: string; stops: TourStop[]; shared: boolean; mine: boolean; by: string | null };
export type TourActionState = { ok?: string; error?: string; tour?: Tour; deletedId?: number } | null;

const TourSchema = z.object({
  facilityId: reqId("Hospital"), tourId: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().positive().optional()),
  name: z.string().trim().min(1, "Give the tour a name.").max(80, "Keep the name under 80 characters."),
  stops: z.string().max(60000), shared: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});
const StopSchema = z.array(z.object({ state: z.string().max(2000), caption: z.string().trim().max(400), seconds: z.coerce.number().int().min(2).max(120) })).min(1, "Add at least one stop.").max(40, "A tour can have up to 40 stops.");

/** Save a new tour, or change one of your own. Anyone who can see the hospital may make tours. */
export async function saveTourAction(_: TourActionState, fd: FormData): Promise<TourActionState> {
  const me = await requirePermission("assets.view");
  const p = TourSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await requireFacilityAccess(p.data.facilityId, me);
  let raw: unknown; try { raw = JSON.parse(p.data.stops); } catch { return { error: "The tour's stops couldn't be read." }; }
  const st = StopSchema.safeParse(raw);
  if (!st.success) return { error: firstError(st.error) };
  if (st.data.some((x) => !decodeView(x.state))) return { error: "One of the stops couldn't be read. Remove it and add the view again." };
  if (p.data.tourId) {
    const [t] = await db.select().from(twinTours).where(eq(twinTours.id, p.data.tourId));
    if (!t || t.facilityId !== p.data.facilityId) return { error: "That tour no longer exists." };
    if (t.createdById !== me.id && !can(me.role, "users.manage")) return { error: "Only the person who made this tour can change it." };
    await db.update(twinTours).set({ name: p.data.name, stops: st.data, shared: p.data.shared }).where(eq(twinTours.id, t.id));
    return { ok: `Tour “${p.data.name}” saved.`, tour: { id: t.id, name: p.data.name, stops: st.data, shared: p.data.shared, mine: t.createdById === me.id, by: t.createdByName } };
  }
  const [row] = await db.insert(twinTours).values({ facilityId: p.data.facilityId, name: p.data.name, stops: st.data, shared: p.data.shared, createdById: me.id, createdByName: me.name }).returning({ id: twinTours.id });
  return { ok: `Tour “${p.data.name}” saved${p.data.shared ? " and shared" : ""}.`, tour: { id: row.id, name: p.data.name, stops: st.data, shared: p.data.shared, mine: true, by: me.name } };
}

export async function deleteTourAction(_: TourActionState, fd: FormData): Promise<TourActionState> {
  const me = await requirePermission("assets.view");
  const id = Number(fd.get("tourId"));
  const [t] = Number.isInteger(id) ? await db.select().from(twinTours).where(eq(twinTours.id, id)) : [];
  if (!t) return { error: "That tour no longer exists." };
  await requireFacilityAccess(t.facilityId, me);
  if (t.createdById !== me.id && !can(me.role, "users.manage")) return { error: "Only the person who made this tour can delete it." };
  await db.delete(twinTours).where(eq(twinTours.id, t.id));
  return { ok: `Tour “${t.name}” deleted.`, deletedId: t.id };
}

/* ── Walking network: manual fixes and access zones (wave 7, step 7a) ── */

export type FixActionState = { ok?: string; error?: string; fix?: TwinFix; deletedId?: number; roomId?: number; zone?: TwinRoom["zone"] } | null;
const FixSchema = z.object({
  floorId: reqId("Floor"), kind: z.enum(["OPEN", "CLOSE"], { error: "Choose open or close." }),
  x1: z.coerce.number().finite(), y1: z.coerce.number().finite(), x2: z.coerce.number().finite(), y2: z.coerce.number().finite(), note: text(300),
});

async function floorFacility(floorId: number) {
  const [f] = await db.select({ facilityId: buildings.facilityId }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.id, floorId));
  return f?.facilityId ?? null;
}

/** Open a gap the drawing closes (a door it doesn't show) or close one it leaves open. Needs facilities.edit. */
export async function addRouteFixAction(_: FixActionState, fd: FormData): Promise<FixActionState> {
  const me = await requirePermission("facilities.edit");
  const p = FixSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const fac = await floorFacility(p.data.floorId); if (fac == null) return { error: "That floor no longer exists." };
  await requireFacilityAccess(fac, me);
  const [row] = await db.insert(routeFixes).values({ ...p.data, note: p.data.note ?? null, createdByName: me.name }).returning();
  return {
    ok: p.data.kind === "OPEN" ? "Opening added; routes on this floor use it now." : "Gap closed; routes on this floor go round it now.",
    fix: { id: row.id, floorId: row.floorId, kind: row.kind, x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2, note: row.note, by: row.createdByName },
  };
}

export async function deleteRouteFixAction(_: FixActionState, fd: FormData): Promise<FixActionState> {
  const me = await requirePermission("facilities.edit");
  const id = Number(fd.get("fixId"));
  const [f] = Number.isInteger(id) ? await db.select().from(routeFixes).where(eq(routeFixes.id, id)) : [];
  if (!f) return { error: "That fix no longer exists." };
  const fac = await floorFacility(f.floorId); if (fac != null) await requireFacilityAccess(fac, me);
  await db.delete(routeFixes).where(eq(routeFixes.id, f.id));
  return { ok: "Fix removed.", deletedId: f.id };
}

const ZONES = ["PUBLIC", "PATIENT", "STAFF", "STERILE", "ISOLATION"] as const;
/** Set a room's access zone (empty = read from its name). Needs facilities.edit. */
export async function setRoomZoneAction(_: FixActionState, fd: FormData): Promise<FixActionState> {
  const me = await requirePermission("facilities.edit");
  const roomId = Number(fd.get("roomId")); const raw = String(fd.get("zone") ?? "");
  const zone = (ZONES as readonly string[]).includes(raw) ? (raw as (typeof ZONES)[number]) : null;
  if (raw && !zone) return { error: "Choose a zone from the list." };
  const [r] = Number.isInteger(roomId) ? await db.select({ id: rooms.id, floorId: rooms.floorId, name: rooms.name }).from(rooms).where(eq(rooms.id, roomId)) : [];
  if (!r) return { error: "That room no longer exists." };
  const fac = await floorFacility(r.floorId); if (fac != null) await requireFacilityAccess(fac, me);
  await db.update(rooms).set({ zone }).where(eq(rooms.id, r.id));
  return { ok: zone ? `${r.name}: ${zone.toLowerCase()} zone.` : `${r.name}: zone read from its name again.`, roomId: r.id, zone };
}

/** Mark a room as (or no longer) a biomedical workshop (wave 8). Needs facilities.edit. */
export async function setWorkshopAction(_: FixActionState, fd: FormData): Promise<FixActionState> {
  const me = await requirePermission("facilities.edit");
  const roomId = Number(fd.get("roomId")); const on = fd.get("on") === "1";
  const [r] = Number.isInteger(roomId) ? await db.select({ id: rooms.id, floorId: rooms.floorId, name: rooms.name }).from(rooms).where(eq(rooms.id, roomId)) : [];
  if (!r) return { error: "That room no longer exists." };
  const fac = await floorFacility(r.floorId); if (fac != null) await requireFacilityAccess(fac, me);
  await db.update(rooms).set({ workshop: on }).where(eq(rooms.id, r.id));
  return { ok: on ? `${r.name} is marked as a workshop: work orders show the route from it.` : `${r.name} is no longer a workshop.`, roomId: r.id };
}

/* ── Photos on notes (wave 8, A8) ── */

export type NotePhoto = { id: number; url: string; name: string };
export type PhotoActionState = { ok?: string; error?: string; noteId?: number; photo?: NotePhoto } | null;

/** Attach a photo (camera or file) to a note: anyone who may see the hospital, like notes themselves. */
export async function addNotePhotoAction(_: PhotoActionState, fd: FormData): Promise<PhotoActionState> {
  const me = await requirePermission("assets.view");
  const noteId = Number(fd.get("noteId")); const file = fd.get("photo");
  const [n] = Number.isInteger(noteId) ? await db.select({ id: twinNotes.id, facilityId: twinNotes.facilityId }).from(twinNotes).where(eq(twinNotes.id, noteId)) : [];
  if (!n) return { error: "That note no longer exists." };
  await requireFacilityAccess(n.facilityId, me);
  if (!(file instanceof File) || !file.size) return { error: "Choose a photo." };
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || !fileKind(file.name)?.mime.startsWith("image/")) return { error: "Photos must be JPEG, PNG, WebP or GIF." };
  if (file.size > 10 * 1024 * 1024) return { error: "Keep photos under 10 MB." };
  const url = await storeFile(`twin_note/${n.id}`, file.name, new Uint8Array(await file.arrayBuffer()));
  const [doc] = await db.insert(documents).values({ entityType: "twin_note", entityId: n.id, kind: "photo", fileName: file.name, sizeBytes: file.size, url }).returning({ id: documents.id });
  return { ok: "Photo added.", noteId: n.id, photo: { id: doc.id, url, name: file.name } };
}

/** Keep a render (or a floor book) in the hospital's documents (wave 8, A10). Needs facilities.edit. */
export async function saveRenderDocumentAction(_: PhotoActionState, fd: FormData): Promise<PhotoActionState> {
  const me = await requirePermission("facilities.edit");
  const facilityId = Number(fd.get("facilityId")); const file = fd.get("file");
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose a hospital." };
  await requireFacilityAccess(facilityId, me);
  if (!(file instanceof File) || !file.size) return { error: "Nothing to save." };
  const kind = fileKind(file.name);
  if (!kind || !/^(image\/(png|jpeg)|application\/(pdf|zip))$/.test(kind.mime)) return { error: "Renders are saved as PNG, JPEG, PDF or ZIP." };
  if (file.size > 25 * 1024 * 1024) return { error: "That file is over 25 MB; save a smaller size or a JPEG." };
  const url = await storeFile(`facility/${facilityId}`, file.name, new Uint8Array(await file.arrayBuffer()));
  const [doc] = await db.insert(documents).values({ entityType: "facility", entityId: facilityId, kind: kind.mime.startsWith("image/") ? "photo" : "other", fileName: file.name, sizeBytes: file.size, url }).returning({ id: documents.id });
  return { ok: `${file.name} saved to the hospital's documents.`, photo: { id: doc.id, url, name: file.name } };
}

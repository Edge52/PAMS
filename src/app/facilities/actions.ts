"use server";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, buildings, departments, facilities, floors, liftCores, rooms, userFacilities, type LiftStop } from "@/db/schema";
import { logActivity } from "@/lib/server-utils";
import { FACILITY_TYPES, ROOM_TYPES } from "@/lib/assets/filters";
import { code, dbError, firstError, formObject, id, int, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import { imageSize, planSizeFor } from "@/lib/assets/image-size";
import { storeFile } from "@/lib/storage";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { LIFT_KINDS } from "@/lib/assets/lifts";
import { addLiftSuggestions, liftFloors } from "@/lib/assets/lifts-data";

/** facilities.edit and access to the facility being changed (redirects to /forbidden otherwise). */
async function editFacility(facilityId: number) {
  const me = await requirePermission("facilities.edit");
  if (Number.isInteger(facilityId) && facilityId > 0) await requireFacilityAccess(facilityId, me);
  return me;
}

const back = (facilityId: number, tab: string, notice: string, extra = "") =>
  `/facilities/${facilityId}?tab=${tab}${extra}&notice=${encodeURIComponent(notice)}`;

/* ── Facility ── */

const FacilitySchema = z.object({
  code: code("Code", 32), name: reqText("Name"), nameAr: text(), type: oneOf("Facility type", FACILITY_TYPES),
  governorate: text(80), city: text(80), address: text(300), totalBeds: int("Total beds", 0, 10000),
});

export async function createFacility(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("facilities.edit");
  const p = FacilitySchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  let newId: number;
  try {
    const [row] = await db.insert(facilities).values({ ...p.data, nameAr: p.data.nameAr ?? null, type: p.data.type ?? "GENERAL_HOSPITAL", totalBeds: p.data.totalBeds ?? 0 }).returning();
    newId = row.id;
    // Every facility starts with one building so floors can be added straight away.
    await db.insert(buildings).values({ facilityId: row.id, code: "B1", name: "Main building" });
    // A user limited to some facilities can see the one they just created.
    if (me.role !== "ADMIN" && !me.allFacilities) await db.insert(userFacilities).values({ userId: me.id, facilityId: row.id }).onConflictDoNothing();
  } catch (e) { return { error: dbError(e) }; }
  revalidatePath("/facilities");
  redirect(back(newId, "buildings", "Facility created. Add floors to the main building next."));
}

export async function updateFacility(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("facilities.edit");
  const fid = Number(fd.get("facilityId"));
  if (!Number.isInteger(fid) || fid <= 0) return { error: "That facility no longer exists." };
  await editFacility(fid);
  const p = FacilitySchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  try {
    await db.update(facilities).set({ ...p.data, nameAr: p.data.nameAr ?? null, governorate: p.data.governorate ?? null, city: p.data.city ?? null,
      address: p.data.address ?? null, type: p.data.type ?? "GENERAL_HOSPITAL", totalBeds: p.data.totalBeds ?? 0 }).where(eq(facilities.id, fid));
  } catch (e) { return { error: dbError(e) }; }
  revalidatePath(`/facilities/${fid}`);
  redirect(back(fid, "overview", "Facility details saved."));
}

/* ── Buildings ── */

const BuildingSchema = z.object({ facilityId: reqId("Facility"), buildingId: id(), code: code("Building code"), name: reqText("Building name") });

export async function saveBuilding(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("facilities.edit");
  const p = BuildingSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await editFacility(p.data.facilityId);
  const { facilityId, buildingId, ...v } = p.data;
  try {
    if (buildingId) await db.update(buildings).set(v).where(and(eq(buildings.id, buildingId), eq(buildings.facilityId, facilityId)));
    else await db.insert(buildings).values({ facilityId, ...v });
  } catch (e) { return { error: dbError(e) }; }
  revalidatePath(`/facilities/${facilityId}`);
  redirect(back(facilityId, "buildings", buildingId ? "Building saved." : `Building ${v.name} added.`));
}

export async function deleteBuilding(fd: FormData) {
  await requirePermission("facilities.edit");
  const bid = Number(fd.get("buildingId")), fid = Number(fd.get("facilityId"));
  await editFacility(fid);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(floors).where(eq(floors.buildingId, bid));
  if (n > 0) redirect(`/facilities/${fid}?tab=buildings&error=${encodeURIComponent("Remove the building's floors first.")}`);
  await db.delete(buildings).where(and(eq(buildings.id, bid), eq(buildings.facilityId, fid)));
  revalidatePath(`/facilities/${fid}`);
  redirect(back(fid, "buildings", "Building removed."));
}

/* ── Ownership checks: never trust ids from the form to belong to the facility being edited ── */

async function floorInFacility(floorId: number, facilityId: number): Promise<boolean> {
  const [r] = await db.select({ id: floors.id }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(and(eq(floors.id, floorId), eq(buildings.facilityId, facilityId)));
  return !!r;
}
async function roomInFacility(roomId: number, facilityId: number): Promise<{ floorId: number } | null> {
  const [r] = await db.select({ floorId: rooms.floorId }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(and(eq(rooms.id, roomId), eq(buildings.facilityId, facilityId)));
  return r ?? null;
}
async function departmentsInFacility(ids: number[], facilityId: number): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const found = await db.select({ id: departments.id }).from(departments)
    .where(and(inArray(departments.id, unique), eq(departments.facilityId, facilityId)));
  return found.length === unique.length;
}

/* ── Floors (with plan image upload) ── */

const FloorSchema = z.object({
  facilityId: reqId("Facility"), buildingId: reqId("Building"), floorId: id(),
  name: reqText("Floor name"), level: int("Level", -10, 200).refine((v) => v !== undefined, "Level is required."),
  planWidth: int("Plan width", 100, 20000), planHeight: int("Plan height", 100, 20000),
  removePlan: z.string().optional(), matchImage: z.string().optional(),
});

// Raster only: an SVG can carry script, and pattern filters for it are easy to bypass.
const PLAN_TYPES: Record<string, string> = { png: ".png", jpeg: ".jpg", gif: ".gif", webp: ".webp" };

async function storePlanImage(file: File): Promise<{ url: string; size: { w: number; h: number } | null } | { error: string }> {
  if (file.size > 15 * 1024 * 1024) return { error: "Floor plan images must be 15 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = imageSize(bytes);
  if (!info || !PLAN_TYPES[info.type]) return { error: "Upload the floor plan as PNG, JPEG, WebP or GIF. If you have a PDF or SVG, export it as PNG first." };
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "plan";
  const url = await storeFile("plans", `${base}${PLAN_TYPES[info.type]}`, bytes);
  return { url, size: planSizeFor(info) };
}

export async function saveFloor(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("facilities.edit");
  const p = FloorSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await editFacility(p.data.facilityId);
  const { facilityId, buildingId, floorId, name, level, removePlan, matchImage } = p.data;
  let planWidth = p.data.planWidth ?? 1000, planHeight = p.data.planHeight ?? 600;
  let planImageUrl: string | null | undefined = removePlan ? null : undefined;
  const file = fd.get("planImage");
  if (file instanceof File && file.size > 0) {
    const stored = await storePlanImage(file);
    if ("error" in stored) return { error: stored.error };
    planImageUrl = stored.url;
    if (matchImage && stored.size) { planWidth = stored.size.w; planHeight = stored.size.h; }
  }
  const [b] = await db.select({ id: buildings.id }).from(buildings).where(and(eq(buildings.id, buildingId), eq(buildings.facilityId, facilityId)));
  if (!b) return { error: "Choose a building of this facility." };
  if (floorId && !(await floorInFacility(floorId, facilityId))) return { error: "That floor belongs to another facility." };
  try {
    const v = { buildingId, name, level: level as number, planWidth, planHeight, ...(planImageUrl !== undefined ? { planImageUrl } : {}) };
    if (floorId) await db.update(floors).set(v).where(eq(floors.id, floorId));
    else await db.insert(floors).values(v);
  } catch (e) { return { error: dbError(e, "Could not save the floor.").replace("That code", "That level") }; }
  revalidatePath(`/facilities/${facilityId}`);
  revalidatePath("/assets/map");
  redirect(back(facilityId, "buildings", floorId ? `${name} saved.` : `${name} added. Draw its rooms in the layout editor.`));
}

export async function deleteFloor(fd: FormData) {
  await requirePermission("facilities.edit");
  const flid = Number(fd.get("floorId")), fid = Number(fd.get("facilityId"));
  await editFacility(fid);
  if (!(await floorInFacility(flid, fid))) redirect(`/facilities/${fid}?tab=buildings&error=${encodeURIComponent("That floor belongs to another facility.")}`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(rooms).where(eq(rooms.floorId, flid));
  if (n > 0) redirect(`/facilities/${fid}?tab=buildings&error=${encodeURIComponent("This floor still has rooms. Remove or move them first.")}`);
  await db.delete(floors).where(eq(floors.id, flid));
  revalidatePath(`/facilities/${fid}`);
  redirect(back(fid, "buildings", "Floor removed."));
}

/* ── Departments ── */

const DeptSchema = z.object({
  facilityId: reqId("Facility"), departmentId: id(), departmentTypeCode: text(32), code: code("Department code"),
  name: reqText("Department name"), nameAr: text(), beds: int("Beds", 0, 5000), headName: text(120), costCenter: text(32),
});

export async function saveDepartment(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("facilities.edit");
  const p = DeptSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await editFacility(p.data.facilityId);
  const { facilityId, departmentId, ...d } = p.data;
  const v = { ...d, departmentTypeCode: d.departmentTypeCode ?? null, nameAr: d.nameAr ?? null, beds: d.beds ?? 0, headName: d.headName ?? null, costCenter: d.costCenter ?? null };
  let savedId = departmentId;
  try {
    if (departmentId) await db.update(departments).set(v).where(and(eq(departments.id, departmentId), eq(departments.facilityId, facilityId)));
    else savedId = (await db.insert(departments).values({ facilityId, ...v }).returning({ id: departments.id }))[0].id;
  } catch (e) { return { error: dbError(e) }; }
  if (savedId) await logActivity("department", savedId, departmentId ? "updated" : "created", `${v.name} (${v.code}) ${departmentId ? "updated" : "created"}`);
  revalidatePath(`/facilities/${facilityId}`);
  redirect(back(facilityId, "departments", departmentId ? `${v.name} saved.` : `${v.name} added.`));
}

export async function deleteDepartment(fd: FormData) {
  await requirePermission("facilities.edit");
  const did = Number(fd.get("departmentId")), fid = Number(fd.get("facilityId"));
  await editFacility(fid);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(eq(assets.departmentId, did));
  if (n > 0) redirect(`/facilities/${fid}?tab=departments&error=${encodeURIComponent(`This department still has ${n} assets. Move them first.`)}`);
  await db.delete(departments).where(and(eq(departments.id, did), eq(departments.facilityId, fid)));
  revalidatePath(`/facilities/${fid}`);
  redirect(back(fid, "departments", "Department removed. Its rooms are now unassigned."));
}

/* ── Rooms ── */

const RoomSchema = z.object({
  facilityId: reqId("Facility"), floorId: reqId("Floor"), roomId: id(), departmentId: id(),
  code: code("Room code"), name: reqText("Room name"), type: oneOf("Room type", ROOM_TYPES), beds: int("Beds", 0, 500),
  x: num("X", 0, 20000), y: num("Y", 0, 20000), w: num("Width", 5, 20000), h: num("Height", 5, 20000),
});

export async function saveRoom(_: FormState, fd: FormData): Promise<FormState> {
  await requirePermission("facilities.edit");
  const p = RoomSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  await editFacility(p.data.facilityId);
  const { facilityId, floorId, roomId, ...r } = p.data;
  if (!(await floorInFacility(floorId, facilityId))) return { error: "Choose a floor of this facility." };
  if (r.departmentId && !(await departmentsInFacility([r.departmentId], facilityId))) return { error: "Choose a department of this facility." };
  if (roomId && !(await roomInFacility(roomId, facilityId))) return { error: "That room belongs to another facility." };
  const v = { floorId, departmentId: r.departmentId ?? null, code: r.code, name: r.name, type: r.type ?? "OTHER", beds: r.beds ?? 0,
    x: r.x ?? 20, y: r.y ?? 20, w: r.w ?? 100, h: r.h ?? 80 };
  try {
    if (roomId) {
      await db.update(rooms).set(v).where(eq(rooms.id, roomId));
      // Equipment follows its room's department.
      if (v.departmentId) await db.update(assets).set({ departmentId: v.departmentId }).where(eq(assets.roomId, roomId));
    } else await db.insert(rooms).values(v);
  } catch (e) { return { error: dbError(e).replace("code is", "room code is") }; }
  revalidatePath(`/facilities/${facilityId}`);
  revalidatePath("/assets/map");
  redirect(back(facilityId, "rooms", roomId ? `Room ${v.code} saved.` : `Room ${v.code} added.`, `&floorId=${floorId}`));
}

export async function deleteRoom(fd: FormData) {
  await requirePermission("facilities.edit");
  const rid = Number(fd.get("roomId")), fid = Number(fd.get("facilityId")), flid = Number(fd.get("floorId"));
  await editFacility(fid);
  if (!(await roomInFacility(rid, fid))) redirect(`/facilities/${fid}?tab=rooms&floorId=${flid}&error=${encodeURIComponent("That room belongs to another facility.")}`);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(assets).where(eq(assets.roomId, rid));
  if (n > 0) redirect(`/facilities/${fid}?tab=rooms&floorId=${flid}&error=${encodeURIComponent(`This room still holds ${n} assets. Move them first.`)}`);
  await db.delete(rooms).where(eq(rooms.id, rid));
  revalidatePath(`/facilities/${fid}`);
  redirect(back(fid, "rooms", "Room removed.", `&floorId=${flid}`));
}

/* ── Room layout editor ── */

const LayoutRoom = z.object({
  id: z.number().int().positive().nullable(),
  code: z.string().trim().min(1, "Every room needs a code.").max(32).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "Every room needs a name.").max(200),
  type: z.enum(ROOM_TYPES as unknown as [string, ...string[]]),
  departmentId: z.number().int().positive().nullable(),
  beds: z.number().int().min(0).max(500),
  x: z.number().min(-1).max(20000), y: z.number().min(-1).max(20000), w: z.number().min(5).max(20000), h: z.number().min(5).max(20000),
});
const LayoutSchema = z.object({ floorId: z.number().int().positive(), rooms: z.array(LayoutRoom).max(1000) });

export type LayoutResult = { ok: true; message: string; idMap: Record<string, number> } | { ok: false; error: string };

/** Save the whole floor layout from the editor: update moved/resized rooms, insert new ones, delete removed ones (if empty). */
export async function saveFloorLayout(input: unknown): Promise<LayoutResult> {
  await requirePermission("facilities.edit");
  const p = LayoutSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "The layout could not be read." };
  const { floorId } = p.data;
  const list = p.data.rooms;
  const codes = list.map((r) => r.code);
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) return { ok: false, error: `Room code ${dup} is used twice on this floor.` };

  const [fl] = await db.select({ id: floors.id, facilityId: buildings.facilityId }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.id, floorId));
  if (!fl) return { ok: false, error: "That floor no longer exists." };
  await editFacility(fl.facilityId);
  const keepIds = list.flatMap((r) => (r.id ? [r.id] : []));
  if (keepIds.length) {
    const onFloor = await db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.floorId, floorId), inArray(rooms.id, keepIds)));
    if (onFloor.length !== new Set(keepIds).size) return { ok: false, error: "The layout refers to rooms that aren't on this floor. Reload the editor and try again." };
  }
  const deptIds = list.flatMap((r) => (r.departmentId ? [r.departmentId] : []));
  if (!(await departmentsInFacility(deptIds, fl.facilityId))) return { ok: false, error: "Some rooms are assigned to departments of another facility. Reload the editor and try again." };
  const removed = await db.select({ id: rooms.id, code: rooms.code }).from(rooms)
    .where(and(eq(rooms.floorId, floorId), keepIds.length ? notInArray(rooms.id, keepIds) : undefined));
  if (removed.length) {
    const busy = await db.select({ roomId: assets.roomId, n: sql<number>`count(*)::int` }).from(assets)
      .where(inArray(assets.roomId, removed.map((r) => r.id))).groupBy(assets.roomId);
    if (busy.length) {
      const codesBusy = busy.map((b) => removed.find((r) => r.id === b.roomId)?.code).join(", ");
      return { ok: false, error: `Rooms ${codesBusy} still hold equipment — move it before deleting those rooms.` };
    }
  }
  const idMap: Record<string, number> = {};
  try {
    await db.transaction(async (tx) => {
      if (removed.length) await tx.delete(rooms).where(inArray(rooms.id, removed.map((r) => r.id)));
      // Free codes first so swapping codes between rooms does not trip the unique index.
      for (const r of list) if (r.id) await tx.update(rooms).set({ code: `__tmp_${r.id}` }).where(and(eq(rooms.id, r.id), eq(rooms.floorId, floorId)));
      for (const [i, r] of list.entries()) {
        const v = { code: r.code, name: r.name, type: r.type as (typeof ROOM_TYPES)[number], departmentId: r.departmentId, beds: r.beds,
          x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
        if (r.id) {
          await tx.update(rooms).set(v).where(and(eq(rooms.id, r.id), eq(rooms.floorId, floorId)));
          if (r.departmentId) await tx.update(assets).set({ departmentId: r.departmentId }).where(eq(assets.roomId, r.id));
        } else {
          const [row] = await tx.insert(rooms).values({ floorId, ...v }).returning({ id: rooms.id });
          idMap[`new-${i}`] = row.id;
        }
      }
    });
  } catch (e) { return { ok: false, error: dbError(e, "The layout could not be saved.") }; }
  revalidatePath(`/facilities/${fl.facilityId}`);
  revalidatePath("/assets/map");
  const added = Object.keys(idMap).length;
  return { ok: true, idMap, message: `Layout saved — ${list.length} rooms${added ? `, ${added} new` : ""}${removed.length ? `, ${removed.length} removed` : ""}.` };
}

/* ── Lifts (wave 7) ── */

const LiftSchema = z.object({
  facilityId: reqId("Facility"), liftId: id("Lift").optional(),
  name: reqText("Name", 120), kind: oneOf("Kind", LIFT_KINDS),
  cars: int("Cars", 1, 20), carCapacity: int("People per car", 1, 60).optional(), waitSeconds: int("Typical wait", 0, 900),
  x: num("Position across", -100000, 100000).optional(), y: num("Position down", -100000, 100000).optional(),
  note: text(1000), confirmed: z.preprocess((v) => v === "on" || v === "1", z.boolean()),
});

/**
 * Save a lift core. Floors come from the ticked boxes: a floor it already stopped on keeps its stop; a newly ticked
 * floor gets a stop at the position given (metres from the plan's left and top edges), or at the lift's existing
 * position, or at the middle of the floor.
 */
export async function saveLift(_: FormState, fd: FormData): Promise<FormState> {
  const p = LiftSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const me = await editFacility(p.data.facilityId);
  const { facilityId, liftId, x, y, confirmed, ...d } = p.data;
  if (!d.kind) return { error: "Choose the kind of lift." };
  const kind = d.kind;
  const fl = await liftFloors(db, facilityId);
  const ticked = fd.getAll("floorIds").map(Number).filter((n) => fl.some((f) => f.id === n));
  if (ticked.length < 2) return { error: "Tick at least two floors the lift stops on." };
  const [old] = liftId ? await db.select().from(liftCores).where(and(eq(liftCores.id, liftId), eq(liftCores.facilityId, facilityId))) : [];
  if (liftId && !old) return { error: "That lift no longer exists." };
  const sizes = await db.select({ id: floors.id, w: floors.planWidth, h: floors.planHeight }).from(floors).where(inArray(floors.id, ticked));
  const stops: LiftStop[] = ticked.map((floorId) => {
    const kept = old?.stops.find((s) => s.floorId === floorId);
    if (kept && x == null && y == null) return kept;
    const upm = fl.find((f) => f.id === floorId)?.unitsPerMetre ?? 10;
    const any = old?.stops[0];
    const size = sizes.find((s) => s.id === floorId);
    return {
      floorId,
      x: x != null ? x * upm : any?.x ?? (size?.w ?? 0) / 2,
      y: y != null ? y * upm : any?.y ?? (size?.h ?? 0) / 2,
    };
  });
  const v = {
    name: d.name, kind, cars: d.cars ?? 1, carCapacity: d.carCapacity ?? null, waitSeconds: d.waitSeconds ?? 45, note: d.note ?? null,
    stops, inferred: old ? old.inferred && !confirmed : false,
  };
  let savedId = liftId;
  try {
    if (liftId) await db.update(liftCores).set(v).where(eq(liftCores.id, liftId));
    else savedId = (await db.insert(liftCores).values({ facilityId, ...v }).returning({ id: liftCores.id }))[0].id;
  } catch (e) { return { error: dbError(e) }; }
  await logActivity("lift", savedId!, liftId ? "updated" : "created", `${v.name} ${liftId ? "updated" : "added"} (${stops.length} floors)`, me.name);
  revalidatePath(`/facilities/${facilityId}`);
  revalidatePath("/assets/3d");
  redirect(back(facilityId, "lifts", liftId ? `${v.name} saved.` : `${v.name} added.`));
}

export async function confirmLift(fd: FormData) {
  const lid = Number(fd.get("liftId")), fid = Number(fd.get("facilityId"));
  const me = await editFacility(fid);
  const [l] = await db.update(liftCores).set({ inferred: false }).where(and(eq(liftCores.id, lid), eq(liftCores.facilityId, fid))).returning({ name: liftCores.name });
  if (l) await logActivity("lift", lid, "confirmed", `${l.name} confirmed`, me.name);
  revalidatePath(`/facilities/${fid}`);
  revalidatePath("/assets/3d");
  redirect(back(fid, "lifts", l ? `${l.name} confirmed.` : "That lift no longer exists."));
}

export async function deleteLift(fd: FormData) {
  const lid = Number(fd.get("liftId")), fid = Number(fd.get("facilityId"));
  const me = await editFacility(fid);
  const [l] = await db.delete(liftCores).where(and(eq(liftCores.id, lid), eq(liftCores.facilityId, fid))).returning({ name: liftCores.name });
  if (l) await logActivity("lift", lid, "deleted", `${l.name} removed`, me.name);
  revalidatePath(`/facilities/${fid}`);
  revalidatePath("/assets/3d");
  redirect(back(fid, "lifts", "Lift removed."));
}

/** Add the lifts the drawings suggest that this hospital doesn't have yet (by name). */
export async function suggestLiftsAction(fd: FormData) {
  const fid = Number(fd.get("facilityId"));
  await editFacility(fid);
  const n = await addLiftSuggestions(db, fid);
  revalidatePath(`/facilities/${fid}`);
  revalidatePath("/assets/3d");
  redirect(back(fid, "lifts", n ? `${n} lift${n === 1 ? "" : "s"} suggested from the drawings. Check them and confirm.` : "No new lifts found in the drawings."));
}

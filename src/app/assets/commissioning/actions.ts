"use server";
/** Commissioning plans (wave 14): make one from floors of a hospital, set planned and actual dates, remove it. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { buildings, commissioningPlans, commissioningRooms, floors, projects, rooms } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import { NO_EQUIPMENT_TYPES } from "@/lib/assets/commissioning";
import { coreKind } from "@/components/assets/twin/geometry";
import type { FormState } from "@/lib/assets/forms";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDay = z.union([day, z.literal("")]).transform((v) => v || null);

async function planFor(id: number) {
  const me = await requirePermission("facilities.edit");
  const [p] = await db.select().from(commissioningPlans).where(eq(commissioningPlans.id, id));
  if (!p) redirect("/assets/commissioning?error=That+plan+no+longer+exists.");
  await requireFacilityAccess(p.facilityId, me);
  return { me, p };
}
const back = (id: number, kind: "notice" | "error", text: string, extra = "") => redirect(`/assets/commissioning/${id}?${kind}=${encodeURIComponent(text)}${extra}`);

const PlanForm = z.object({
  facilityId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Give the plan a name, e.g. “East wing opening”.").max(160),
  projectId: z.union([z.coerce.number().int().positive(), z.literal("")]).transform((v) => (v === "" ? null : v)),
  startsOn: day,
  installWeeks: z.coerce.number().int().min(0).max(52),
  acceptWeeks: z.coerce.number().int().min(0).max(52),
});

export async function createPlanAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("facilities.edit");
  const parsed = PlanForm.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  await requireFacilityAccess(v.facilityId, me);
  const floorIds = fd.getAll("floorId").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!floorIds.length) return { error: "Tick the floors the building or wing covers." };
  const own = await db.select({ id: floors.id }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId))
    .where(and(inArray(floors.id, floorIds), eq(buildings.facilityId, v.facilityId)));
  if (own.length !== floorIds.length) return { error: "Choose floors of this hospital." };
  if (v.projectId) {
    const [pr] = await db.select({ facilityId: projects.facilityId }).from(projects).where(eq(projects.id, v.projectId));
    if (!pr || (pr.facilityId != null && pr.facilityId !== v.facilityId)) return { error: "Choose a project of this hospital." };
  }
  const deptIds = fd.getAll("departmentId").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const rs = (await db.select({ id: rooms.id, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId }).from(rooms).where(inArray(rooms.floorId, floorIds)))
    // Lifts, stairs, shafts and corridors aren't commissioned room by room.
    .filter((r) => r.type !== "CORRIDOR" && !coreKind(r.name) && (!deptIds.length || (r.departmentId != null && deptIds.includes(r.departmentId))));
  if (!rs.length) return { error: "Those floors have no rooms to commission." };
  const id = await db.transaction(async (tx) => {
    const [p] = await tx.insert(commissioningPlans).values({ ...v, createdByName: me.name }).returning({ id: commissioningPlans.id });
    for (let i = 0; i < rs.length; i += 500) {
      await tx.insert(commissioningRooms).values(rs.slice(i, i + 500).map((r) => ({ planId: p.id, roomId: r.id, handoverPlanned: v.startsOn, noEquipment: NO_EQUIPMENT_TYPES.has(r.type) })));
    }
    await logActivity("commissioning", p.id, "created", `Commissioning plan “${v.name}” made: ${rs.length} rooms`, me.name, tx);
    return p.id;
  });
  revalidatePath("/assets/commissioning");
  redirect(`/assets/commissioning/${id}?notice=${encodeURIComponent(`Plan made with ${rs.length} rooms, all handed over on ${v.startsOn} for now. Set the planned handovers floor by floor below.`)}`);
}

export async function updatePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  const id = Number(fd.get("planId"));
  const { me, p } = await planFor(id);
  const parsed = PlanForm.omit({ facilityId: true }).extend({ notes: z.string().trim().max(2000).optional() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  await db.update(commissioningPlans).set({ ...parsed.data, notes: parsed.data.notes || null }).where(eq(commissioningPlans.id, p.id));
  await logActivity("commissioning", p.id, "updated", `Commissioning plan “${parsed.data.name}” changed`, me.name);
  revalidatePath(`/assets/commissioning/${id}`);
  back(id, "notice", "Plan saved.");
  return null;
}

const FIELDS = { handoverPlanned: "planned handover", installPlanned: "planned installation", acceptPlanned: "planned acceptance", handoverOn: "actual handover" } as const;

/** Set one date for a group of rooms: the whole plan, a floor or a department. */
export async function bulkDatesAction(fd: FormData) {
  const id = Number(fd.get("planId"));
  const { me, p } = await planFor(id);
  const field = String(fd.get("field")) as keyof typeof FIELDS;
  if (!(field in FIELDS)) back(id, "error", "Choose which date to set.");
  const date = optDay.safeParse(String(fd.get("date") ?? ""));
  if (!date.success) { back(id, "error", "Give a date, or leave it empty to clear it."); return; }
  const scope = String(fd.get("scope") ?? "all");
  const [kind, raw] = scope.split(":"); const sid = Number(raw);
  const roomIds = (await db.select({ id: commissioningRooms.roomId }).from(commissioningRooms).innerJoin(rooms, eq(rooms.id, commissioningRooms.roomId))
    .where(and(eq(commissioningRooms.planId, p.id), kind === "floor" ? eq(rooms.floorId, sid) : kind === "dept" ? eq(rooms.departmentId, sid) : undefined))).map((r) => r.id);
  if (!roomIds.length) { back(id, "error", "No rooms of the plan in that group."); return; }
  await db.update(commissioningRooms).set({ [field]: date.data }).where(and(eq(commissioningRooms.planId, p.id), inArray(commissioningRooms.roomId, roomIds)));
  await logActivity("commissioning", p.id, "updated", `${FIELDS[field]} ${date.data ?? "cleared"} for ${roomIds.length} rooms`, me.name);
  revalidatePath(`/assets/commissioning/${id}`);
  back(id, "notice", `${FIELDS[field].charAt(0).toUpperCase()}${FIELDS[field].slice(1)} ${date.data ? `set to ${date.data}` : "cleared"} for ${roomIds.length} room${roomIds.length === 1 ? "" : "s"}.`, kind === "floor" ? `&floorId=${sid}` : "");
}

/** The room table: planned and actual handover, no-equipment, leave out. Fields are named <what>_<roomId>. */
export async function saveRoomsAction(fd: FormData) {
  const id = Number(fd.get("planId"));
  const { me, p } = await planFor(id);
  const ids = fd.getAll("roomId").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  let changed = 0, removed = 0, bad = 0;
  await db.transaction(async (tx) => {
    for (const rid of ids) {
      if (fd.get(`x_${rid}`) === "on") { await tx.delete(commissioningRooms).where(and(eq(commissioningRooms.planId, p.id), eq(commissioningRooms.roomId, rid))); removed++; continue; }
      const h = optDay.safeParse(String(fd.get(`h_${rid}`) ?? "")), o = optDay.safeParse(String(fd.get(`o_${rid}`) ?? ""));
      if (!h.success || !o.success) { bad++; continue; }
      const r = await tx.update(commissioningRooms).set({ handoverPlanned: h.data, handoverOn: o.data, noEquipment: fd.get(`n_${rid}`) === "on" })
        .where(and(eq(commissioningRooms.planId, p.id), eq(commissioningRooms.roomId, rid),
          sql`(${commissioningRooms.handoverPlanned} is distinct from ${h.data} or ${commissioningRooms.handoverOn} is distinct from ${o.data} or ${commissioningRooms.noEquipment} <> ${fd.get(`n_${rid}`) === "on"})`))
        .returning({ id: commissioningRooms.roomId });
      changed += r.length;
    }
    if (changed || removed) await logActivity("commissioning", p.id, "updated", `Rooms: ${changed} changed, ${removed} left out`, me.name, tx);
  });
  revalidatePath(`/assets/commissioning/${id}`);
  const floor = Number(fd.get("floorId"));
  back(id, bad ? "error" : "notice", `${changed} room${changed === 1 ? "" : "s"} changed${removed ? `, ${removed} left out of the plan` : ""}.${bad ? ` ${bad} had a date that couldn't be read.` : ""}`, Number.isInteger(floor) && floor > 0 ? `&floorId=${floor}#rooms` : "#rooms");
}

export async function deletePlanAction(fd: FormData) {
  const id = Number(fd.get("planId"));
  const { me, p } = await planFor(id);
  await db.delete(commissioningPlans).where(eq(commissioningPlans.id, p.id));
  await logActivity("commissioning", p.id, "deleted", `Commissioning plan “${p.name}” removed`, me.name);
  revalidatePath("/assets/commissioning");
  redirect(`/assets/commissioning?notice=${encodeURIComponent(`“${p.name}” removed.`)}`);
}

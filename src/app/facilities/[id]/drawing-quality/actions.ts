"use server";
/** Drawing quality (wave 16): a floor's drawing revision, and a room checked on site (verified) or not. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { buildings, floorCad, floors, rooms } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";

async function facilityOfFloor(floorId: number) {
  const [f] = Number.isInteger(floorId) ? await db.select({ facilityId: buildings.facilityId, name: floors.name }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(floors.id, floorId)) : [];
  return f ?? null;
}
/** Only paths inside the app, so a form can't send people elsewhere. */
const safeBack = (v: FormDataEntryValue | null, fallback: string) => (typeof v === "string" && /^\/[\w\-/?=&%.]*$/.test(v) && !v.startsWith("//") ? v : fallback);

export async function setRevisionAction(fd: FormData) {
  const me = await requirePermission("facilities.edit");
  const floorId = Number(fd.get("floorId"));
  const f = await facilityOfFloor(floorId); if (!f) redirect("/facilities");
  await requireFacilityAccess(f.facilityId, me);
  const rev = String(fd.get("revision") ?? "").trim().slice(0, 80) || null;
  await db.update(floorCad).set({ revision: rev }).where(eq(floorCad.floorId, floorId));
  await logActivity("facility", f.facilityId, "drawing_revision", `${f.name}: drawing revision ${rev ? `set to “${rev}”` : "cleared"}`);
  revalidatePath(`/facilities/${f.facilityId}/drawing-quality`);
  redirect(`/facilities/${f.facilityId}/drawing-quality?notice=${encodeURIComponent(`${f.name}: revision saved.`)}#floor-${floorId}`);
}

export async function verifyRoomAction(fd: FormData) {
  const me = await requirePermission("facilities.edit");
  const roomId = Number(fd.get("roomId"));
  const [r] = Number.isInteger(roomId) ? await db.select({ id: rooms.id, name: rooms.name, code: rooms.code, floorId: rooms.floorId }).from(rooms).where(eq(rooms.id, roomId)) : [];
  if (!r) redirect("/facilities");
  const f = (await facilityOfFloor(r.floorId))!;
  await requireFacilityAccess(f.facilityId, me);
  const on = fd.get("verified") === "1";
  await db.update(rooms).set(on ? { verifiedAt: new Date(), verifiedByName: me.name } : { verifiedAt: null, verifiedByName: null }).where(eq(rooms.id, r.id));
  await logActivity("facility", f.facilityId, on ? "room_verified" : "room_unverified", `${r.name} (${r.code}) ${on ? "checked on site: outline and size verified" : "no longer marked as verified"}`);
  const back = safeBack(fd.get("back"), `/facilities/${f.facilityId}/rooms/${r.id}/sheet`);
  revalidatePath(back.split("?")[0]);
  redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(on ? `${r.name} marked as verified on site.` : `${r.name}: verified mark cleared.`)}`);
}

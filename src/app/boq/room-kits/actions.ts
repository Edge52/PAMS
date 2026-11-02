"use server";
/** Room kits (wave 7): planners and biomedical engineers edit the furniture renders put in each kind of room. */
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { roomKits, roomType } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { FormState } from "@/lib/assets/forms";
import { BUILTIN_KITS, FINISHES, parseItems, type Finish } from "@/components/assets/twin/render/kits";

const back = (notice: string) => redirect(`/boq/room-kits?notice=${encodeURIComponent(notice)}`);

/** The first change copies the built-in kits into the table, so every rule can then be edited. */
async function ensureCopied() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roomKits);
  if (Number(n) > 0) return;
  await db.insert(roomKits).values(BUILTIN_KITS.map((k, i) => ({
    sort: (i + 1) * 10, label: k.label, match: k.match, roomType: k.roomType as (typeof roomType.enumValues)[number] | null, finish: k.finish, items: k.items,
  })));
}

export async function saveKitAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const label = String(fd.get("label") ?? "").trim().slice(0, 120);
  const match = String(fd.get("match") ?? "").trim();
  const type = String(fd.get("roomType") ?? "");
  const finish = String(fd.get("finish") ?? "") as Finish;
  if (!label) return { error: "Give the kit a name, e.g. “Inpatient rooms”." };
  if (!match && !type) return { error: "Give a room-name pattern or choose a room type." };
  if (match) {
    if (match.length > 300) return { error: "Keep the pattern under 300 characters." };
    try { new RegExp(match); } catch { return { error: "The pattern isn't valid. Separate names with | (e.g. WARD|INPATIENT|PATIENT ROOM)." }; }
  }
  if (type && !(roomType.enumValues as readonly string[]).includes(type)) return { error: "Choose a room type from the list." };
  if (!FINISHES.includes(finish)) return { error: "Choose a floor finish." };
  const { items, errors } = parseItems(String(fd.get("items") ?? ""));
  if (errors.length) return { error: errors[0] };
  await ensureCopied();
  const id = await resolveId(fd);
  const values = { label, match: match || null, roomType: match ? null : (type as (typeof roomType.enumValues)[number]), finish, items, updatedByName: me.name };
  if (id) await db.update(roomKits).set(values).where(eq(roomKits.id, id));
  else {
    const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${roomKits.sort}), 0)::int` }).from(roomKits);
    await db.insert(roomKits).values({ ...values, sort: Number(m) + 10 });
  }
  await logActivity("room_kit", id || 0, "updated", `Room kit “${label}” ${id ? "changed" : "added"}`, me.name);
  revalidatePath("/boq/room-kits");
  back(`“${label}” saved. Renders made from now on use it.`);
  return null;
}

/** Before the first change the page shows the built-in kits, which have no ids: those forms send their position. */
async function resolveId(fd: FormData): Promise<number> {
  const id = Number(fd.get("kitId") || 0); if (id) return id;
  const raw = fd.get("kitIndex"); if (raw == null || raw === "") return 0;
  const rows = await db.select({ id: roomKits.id }).from(roomKits).orderBy(asc(roomKits.sort), asc(roomKits.id));
  return rows[Number(raw)]?.id ?? 0;
}

export async function moveKitAction(fd: FormData) {
  await requirePermission("boq.edit");
  await ensureCopied();
  const id = await resolveId(fd), dir = fd.get("dir") === "up" ? -1 : 1;
  const rows = await db.select({ id: roomKits.id }).from(roomKits).orderBy(asc(roomKits.sort), asc(roomKits.id));
  const i = rows.findIndex((r) => r.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await db.transaction(async (tx) => { for (const [k, r] of rows.entries()) await tx.update(roomKits).set({ sort: (k + 1) * 10 }).where(eq(roomKits.id, r.id)); });
  revalidatePath("/boq/room-kits");
}

export async function deleteKitAction(fd: FormData) {
  const me = await requirePermission("boq.edit");
  await ensureCopied();
  const id = await resolveId(fd);
  const [k] = await db.select({ label: roomKits.label }).from(roomKits).where(eq(roomKits.id, id));
  if (!k) back("That kit no longer exists.");
  await db.delete(roomKits).where(eq(roomKits.id, id));
  await logActivity("room_kit", id, "deleted", `Room kit “${k.label}” removed`, me.name);
  revalidatePath("/boq/room-kits");
  back(`“${k.label}” removed.`);
}

export async function resetKitsAction() {
  const me = await requirePermission("boq.edit");
  await db.delete(roomKits);
  await logActivity("room_kit", 0, "updated", "Room kits reset to the built-in set", me.name);
  revalidatePath("/boq/room-kits");
  back("Room kits reset to the built-in set.");
}

"use server";
/** Room standards (wave 14): biomedical engineers and administrators edit the standard sheet for each kind of room. */
import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { roomStandards, roomType } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import type { FormState } from "@/lib/assets/forms";
import { BUILTIN_STANDARDS, parseSpec } from "@/lib/assets/room-standards";

type RoomType = (typeof roomType.enumValues)[number];
const back = (notice: string) => redirect(`/facilities/room-standards?notice=${encodeURIComponent(notice)}`);

/** The first change copies the built-in set into the table, so every rule can then be edited. */
async function ensureCopied() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(roomStandards);
  if (Number(n) > 0) return;
  await db.insert(roomStandards).values(BUILTIN_STANDARDS.map((r, i) => ({
    sort: (i + 1) * 10, label: r.label, match: r.match, roomType: r.roomType as RoomType | null, spec: r.spec, source: r.source,
  })));
}

/** Before the first change the page shows the built-in rules, which have no ids: forms send their position. */
async function resolveId(fd: FormData): Promise<number> {
  const id = Number(fd.get("ruleId") || 0); if (id) return id;
  const raw = fd.get("ruleIndex"); if (raw == null || raw === "") return 0;
  const rows = await db.select({ id: roomStandards.id }).from(roomStandards).orderBy(asc(roomStandards.sort), asc(roomStandards.id));
  return rows[Number(raw)]?.id ?? 0;
}

export async function saveStandardAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("facilities.edit");
  const label = String(fd.get("label") ?? "").trim().slice(0, 120);
  const match = String(fd.get("match") ?? "").trim();
  const type = String(fd.get("roomType") ?? "");
  const source = String(fd.get("source") ?? "").trim().slice(0, 500) || null;
  if (!label) return { error: "Give the standard a name, e.g. “Operating theatre”." };
  if (!match && !type) return { error: "Give a room-name pattern or choose a room type." };
  if (match) {
    if (match.length > 300) return { error: "Keep the pattern under 300 characters." };
    try { new RegExp(match); } catch { return { error: "The pattern isn't valid. Separate names with | (e.g. THEATRE|OPERATING)." }; }
  }
  if (type && !(roomType.enumValues as readonly string[]).includes(type)) return { error: "Choose a room type from the list." };
  const fields: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") fields[k] = v;
  const { spec, errors } = parseSpec(fields);
  if (errors.length) return { error: errors[0] };
  await ensureCopied();
  const id = await resolveId(fd);
  const values = { label, match: match || null, roomType: match ? null : (type as RoomType), spec, source, updatedByName: me.name };
  if (id) await db.update(roomStandards).set(values).where(eq(roomStandards.id, id));
  else {
    const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${roomStandards.sort}), 0)::int` }).from(roomStandards);
    await db.insert(roomStandards).values({ ...values, sort: Number(m) + 10 });
  }
  await logActivity("room_standard", id || 0, "updated", `Room standard “${label}” ${id ? "changed" : "added"}`, me.name);
  revalidatePath("/facilities/room-standards");
  back(`“${label}” saved.`);
  return null;
}

export async function moveStandardAction(fd: FormData) {
  await requirePermission("facilities.edit");
  await ensureCopied();
  const id = await resolveId(fd), dir = fd.get("dir") === "up" ? -1 : 1;
  const rows = await db.select({ id: roomStandards.id }).from(roomStandards).orderBy(asc(roomStandards.sort), asc(roomStandards.id));
  const i = rows.findIndex((r) => r.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  await db.transaction(async (tx) => { for (const [k, r] of rows.entries()) await tx.update(roomStandards).set({ sort: (k + 1) * 10 }).where(eq(roomStandards.id, r.id)); });
  revalidatePath("/facilities/room-standards");
}

export async function deleteStandardAction(fd: FormData) {
  const me = await requirePermission("facilities.edit");
  await ensureCopied();
  const id = await resolveId(fd);
  const [r] = await db.select({ label: roomStandards.label }).from(roomStandards).where(eq(roomStandards.id, id));
  if (!r) { back("That standard no longer exists."); return; }
  await db.delete(roomStandards).where(eq(roomStandards.id, id));
  await logActivity("room_standard", id, "deleted", `Room standard “${r.label}” removed`, me.name);
  revalidatePath("/facilities/room-standards");
  back(`“${r.label}” removed.`);
}

export async function resetStandardsAction() {
  const me = await requirePermission("facilities.edit");
  await db.delete(roomStandards);
  await logActivity("room_standard", 0, "reset", "Room standards reset to the built-in set", me.name);
  revalidatePath("/facilities/room-standards");
  back("Back to the built-in standards.");
}

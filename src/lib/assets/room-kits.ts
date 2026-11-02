import "server-only";
/** Room kits for presentation renders (wave 7): the hospital-wide editable list, or the built-in one when none is saved. */
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { roomKits } from "@/db/schema";
import { BUILTIN_KITS, type KitRule } from "@/components/assets/twin/render/kits";

export async function loadKits(): Promise<{ kits: KitRule[]; custom: boolean }> {
  const rows = await db.select().from(roomKits).orderBy(asc(roomKits.sort), asc(roomKits.id));
  if (!rows.length) return { kits: BUILTIN_KITS, custom: false };
  return { custom: true, kits: rows.map((r) => ({ id: r.id, label: r.label, match: r.match, roomType: r.roomType, finish: r.finish as KitRule["finish"], items: r.items as KitRule["items"] })) };
}

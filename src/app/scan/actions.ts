"use server";
/** Scan a label (wave 26): turn what the camera or a scanner read into the device's page. */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { parseScan } from "@/lib/assets/rounds";

export async function findScanned(raw: string): Promise<{ href: string } | { error: string }> {
  const me = await requirePermission("assets.view");
  const s = parseScan(raw);
  if (!s) return { error: `“${raw.slice(0, 60)}” isn't a device label. Try again, or type the tag.` };
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId }).from(assets)
    .where(s.assetId ? eq(assets.id, s.assetId) : sql`upper(${assets.assetTag}) = ${s.tag}`).limit(1);
  const scope = await facilityScope(me);
  if (!a || (scope !== null && !scope.includes(a.facilityId))) return { error: `No device ${s.tag ?? `#${s.assetId}`} in the register${scope !== null ? " for your hospitals" : ""}.` };
  return { href: `/assets/${a.id}` };
}

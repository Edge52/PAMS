import "server-only";
/** Database side of reading a label (audit B4): find the device by the label's tag first, by its id only as a fallback. */
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { resolveLabel, type LabelHit } from "./rounds";

/** The device a label means, within the user's facilities (`scope` null = all). */
export async function findLabel(scan: { assetId?: number; tag?: string }, scope: number[] | null): Promise<{ id: number; tag: string; tagChanged: boolean } | null> {
  const pick = async (where: SQL): Promise<LabelHit | null> => {
    const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(where).limit(1);
    return a && (scope === null || scope.includes(a.facilityId)) ? { id: a.id, tag: a.tag } : null;
  };
  const byTag = scan.tag ? await pick(sql`upper(${assets.assetTag}) = ${scan.tag.toUpperCase()}`) : null;
  const byId = !byTag && scan.assetId != null ? await pick(eq(assets.id, scan.assetId)) : null;
  const hit = resolveLabel(scan, byTag, byId);
  if (!hit) return null;
  return { ...hit, tag: (byTag ?? byId)!.tag };
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { moveAsset, type MoveResult } from "@/lib/assets/mutations";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { facilityOfAsset } from "@/lib/assets/access";

const MoveSchema = z.object({
  assetId: z.number().int().positive(),
  toRoomId: z.number().int().positive(),
  posX: z.number().finite().nullable(),
  posY: z.number().finite().nullable(),
  reason: z.string().trim().max(500).nullable(),
});

/** Called by the floor map when a pin is dropped (same room → position only; other room → recorded move). */
export async function moveAssetOnMap(input: unknown): Promise<MoveResult> {
  const me = await requirePermission("assets.move");
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That move could not be read. Reload the map and try again." };
  await requireFacilityAccess(await facilityOfAsset(parsed.data.assetId), me);
  const res = await moveAsset({ ...parsed.data, reason: parsed.data.reason || null, movedBy: me.name });
  if (res.ok && res.moved) {
    revalidatePath(`/assets/${parsed.data.assetId}`);
    revalidatePath("/assets");
  }
  return res;
}

import "server-only";
/** Real size of devices (wave 7): resolve each asset's size from itself, its make and model, its type, or typical. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceModels, deviceTypes } from "@/db/schema";
import { resolveDims, type Dims, type DimsSource } from "./dimensions";

export type SizedAsset = { dims: Dims; source: DimsSource; rot: number | null };

/** Sizes for the given assets (or every asset of a facility). */
export async function sizesFor(where: { facilityId: number } | { assetIds: number[] }): Promise<Map<number, SizedAsset>> {
  if ("assetIds" in where && !where.assetIds.length) return new Map();
  const rows = await db.select({
    id: assets.id, rot: assets.posRot, al: assets.lengthM, aw: assets.widthM, ah: assets.heightM,
    ml: deviceModels.lengthM, mw: deviceModels.widthM, mh: deviceModels.heightM,
    tl: deviceTypes.lengthM, tw: deviceTypes.widthM, th: deviceTypes.heightM, code: deviceTypes.code,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(deviceModels, and(eq(deviceModels.deviceTypeId, assets.deviceTypeId),
      sql`lower(${deviceModels.manufacturer}) = lower(${assets.manufacturer})`, sql`lower(${deviceModels.model}) = lower(${assets.model})`))
    .where("facilityId" in where ? eq(assets.facilityId, where.facilityId) : inArray(assets.id, where.assetIds));
  const out = new Map<number, SizedAsset>();
  for (const r of rows) {
    if (out.has(r.id)) continue; // one model row is enough
    const { dims, source } = resolveDims({ l: r.al, w: r.aw, h: r.ah }, { l: r.ml, w: r.mw, h: r.mh }, { l: r.tl, w: r.tw, h: r.th }, r.code);
    out.set(r.id, { dims, source, rot: r.rot });
  }
  return out;
}

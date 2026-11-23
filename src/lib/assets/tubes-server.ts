import "server-only";
/** Database side of X-ray and CT tube life (wave 38). Rules are pure in ./tubes. */
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, tubeReadings, xrayTubes } from "@/db/schema";
import { tubeForecast, type TubeForecast } from "./tubes";

export type TubeRow = typeof xrayTubes.$inferSelect & { readings: (typeof tubeReadings.$inferSelect)[]; forecast: TubeForecast };

const asTube = (t: typeof xrayTubes.$inferSelect) => ({
  installedOn: t.installedOn, counterAtInstall: t.counterAtInstall, warrantyMonths: t.warrantyMonths, warrantyCounter: t.warrantyCounter, expectedLife: t.expectedLife, removedOn: t.removedOn,
});

async function withReadings(tubes: (typeof xrayTubes.$inferSelect)[], today: string): Promise<TubeRow[]> {
  if (!tubes.length) return [];
  const rs = await db.select().from(tubeReadings).where(inArray(tubeReadings.tubeId, tubes.map((t) => t.id))).orderBy(asc(tubeReadings.readOn), asc(tubeReadings.id));
  return tubes.map((t) => {
    const readings = rs.filter((r) => r.tubeId === t.id);
    return { ...t, readings, forecast: tubeForecast(asTube(t), readings, today) };
  });
}

/** Every tube of a device, newest first (the first one without `removedOn` is in use). */
export async function tubesFor(assetId: number, today: string): Promise<TubeRow[]> {
  const tubes = await db.select().from(xrayTubes).where(eq(xrayTubes.assetId, assetId)).orderBy(asc(xrayTubes.installedOn), asc(xrayTubes.id));
  return (await withReadings(tubes, today)).reverse();
}

/** Tubes in use on devices that are not disposed (for the hourly alerts). */
export async function tubesInUse(today: string) {
  const rows = await db.select({ t: xrayTubes, tag: assets.assetTag, typeName: deviceTypes.name }).from(xrayTubes)
    .innerJoin(assets, eq(assets.id, xrayTubes.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(and(isNull(xrayTubes.removedOn), ne(assets.status, "DISPOSED")));
  const full = await withReadings(rows.map((r) => r.t), today);
  return full.map((t) => ({ ...t, tag: rows.find((r) => r.t.id === t.id)!.tag, typeName: rows.find((r) => r.t.id === t.id)!.typeName }));
}

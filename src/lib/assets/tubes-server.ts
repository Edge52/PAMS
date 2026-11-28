import "server-only";
/** Database side of X-ray and CT tube life (wave 38). Rules are pure in ./tubes. */
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { assets, deviceTypes, facilities, tubeReadings, xrayTubes } from "@/db/schema";
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

export type TubeListRow = TubeRow & { tag: string; typeName: string; typeCode: string; facilityName: string; assetStatus: string };

/**
 * Wave 43: every tube in the hospitals in scope, for /assets/tubes (in use by default; `removed` lists the replaced
 * ones). Each carries its forecast from the readings, as on the device page.
 */
export async function tubeList(scope: number[] | null, today: string, o: { facilityId?: number; removed?: boolean } = {}): Promise<TubeListRow[]> {
  if (scope !== null && scope.length === 0) return [];
  const rows = await db.select({ t: xrayTubes, tag: assets.assetTag, typeName: deviceTypes.name, typeCode: deviceTypes.code, facilityName: facilities.name, assetStatus: assets.status })
    .from(xrayTubes).innerJoin(assets, eq(assets.id, xrayTubes.assetId)).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .innerJoin(facilities, eq(facilities.id, xrayTubes.facilityId))
    .where(and(
      o.removed ? isNotNull(xrayTubes.removedOn) : and(isNull(xrayTubes.removedOn), ne(assets.status, "DISPOSED")),
      scope === null ? undefined : inArray(xrayTubes.facilityId, scope),
      o.facilityId ? eq(xrayTubes.facilityId, o.facilityId) : undefined,
    )).limit(5000);
  const full = await withReadings(rows.map((r) => r.t), today);
  const by = new Map(rows.map((r) => [r.t.id, r]));
  return full.map((t) => { const r = by.get(t.id)!; return { ...t, tag: r.tag, typeName: r.typeName, typeCode: r.typeCode, facilityName: r.facilityName, assetStatus: r.assetStatus }; });
}

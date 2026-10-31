import { asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assets, buildings, departments, deviceTypes, facilities, floorCad, floors, rooms } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DEPARTMENT_PALETTE, rectPoly } from "@/components/assets/twin/geometry";
import { TwinView } from "@/components/assets/twin/twin-view";
import type { TwinData } from "@/components/assets/twin/types";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { twinLive } from "@/lib/assets/twin-live";

export const dynamic = "force-dynamic";
export const metadata = { title: "3D view" };

/** Floor-to-floor height when a floor has no stored elevation (La Plaza: 5 m). */
const FLOOR_TO_FLOOR_M = 5;

export default async function ThreeDPage({ searchParams }: { searchParams: Promise<{ facilityId?: string }> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const facs = await db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities)
    .where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.name));
  if (!facs.length) {
    const canAdd = can(me.role, "facilities.edit") && scope === null;
    return (<><PageHeader title="3D view" /><EmptyState title={scope?.length === 0 ? "No facility linked to your account" : "No facility yet"}
      action={canAdd ? <LinkButton href="/facilities/new" variant="primary">Add a facility</LinkButton> : undefined}>
      {scope?.length === 0 ? "Ask an administrator to give you access to a facility." : "Add a hospital with its floors and rooms to see it in 3D."}</EmptyState></>);
  }
  // Default: the facility imported from CAD, else the first one.
  const withCad = await db.selectDistinct({ id: buildings.facilityId }).from(floorCad)
    .innerJoin(floors, eq(floors.id, floorCad.floorId)).innerJoin(buildings, eq(buildings.id, floors.buildingId));
  const wanted = Number(sp.facilityId);
  if (Number.isInteger(wanted) && wanted > 0) await requireFacilityAccess(wanted, me);
  const facility = facs.find((f) => f.id === wanted) ?? facs.find((f) => withCad.some((w) => w.id === f.id)) ?? facs[0];

  const floorRows = await db.select({ f: floors, buildingName: buildings.name, hasCad: sql<boolean>`exists(select 1 from ${floorCad} where ${floorCad.floorId} = ${floors.id})` })
    .from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facility.id)).orderBy(asc(floors.level));
  const floorIds = floorRows.map((r) => r.f.id);
  const roomRows = floorIds.length ? await db.select().from(rooms).where(inArray(rooms.floorId, floorIds)) : [];
  const deptRows = await db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments)
    .where(eq(departments.facilityId, facility.id)).orderBy(asc(departments.name));

  const group = alias(deviceTypes, "grp"), cat = alias(deviceTypes, "cat");
  const assetRows = await db.select({
    id: assets.id, tag: assets.assetTag, deviceType: deviceTypes.name, category: sql<string>`coalesce(${cat.name}, ${group.name}, ${deviceTypes.name})`,
    categoryCode: sql<string>`coalesce(${cat.code}, ${group.code}, ${deviceTypes.code})`, status: assets.status, criticality: assets.criticality,
    roomId: assets.roomId, posX: assets.posX, posY: assets.posY, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber,
  }).from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .leftJoin(group, eq(group.id, deviceTypes.parentId)).leftJoin(cat, eq(cat.id, group.parentId))
    .where(sql`${assets.facilityId} = ${facility.id} and ${assets.status} <> 'DISPOSED' and ${assets.roomId} is not null`);

  const data: TwinData = {
    facility,
    facilities: facs.map((f) => ({ id: f.id, name: f.name })),
    floors: floorRows.map(({ f, buildingName, hasCad }) => ({
      id: f.id, name: floorRows.filter((x) => x.f.level === f.level).length > 1 ? `${buildingName}, ${f.name}` : f.name, level: f.level, buildingName,
      elevation: f.elevation ?? f.level * FLOOR_TO_FLOOR_M, planWidth: f.planWidth, planHeight: f.planHeight,
      // Hand-drawn plans have no scale; 10 units per metre gives the demo grid a believable size.
      unitsPerMetre: f.unitsPerMetre ?? 10, hasCad: Boolean(hasCad),
    })),
    rooms: roomRows.filter((r) => r.type !== "CORRIDOR" || r.polygon).map((r) => ({
      id: r.id, floorId: r.floorId, code: r.code, name: r.name, type: r.type, departmentId: r.departmentId,
      poly: r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h),
    })),
    departments: deptRows.map((d, i) => ({ ...d, color: DEPARTMENT_PALETTE[i % DEPARTMENT_PALETTE.length] })),
    assets: assetRows,
  };
  return <TwinView data={data} live={await twinLive(facility.id)} />;
}

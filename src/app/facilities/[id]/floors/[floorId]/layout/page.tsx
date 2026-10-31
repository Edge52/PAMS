import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, departments, facilities, floors, rooms } from "@/db/schema";
import { LinkButton, PageHeader } from "@/components/ui";
import { LayoutEditor } from "@/components/assets/layout-editor";
import { ROOM_TYPES } from "@/lib/assets/filters";
import { DEPT_TINTS, deptTintMap } from "@/lib/assets/visuals";
import { saveFloorLayout } from "../../../../actions";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Room layout" };

export default async function LayoutPage({ params }: { params: Promise<{ id: string; floorId: string }> }) {
  await requirePermission("assets.view");
  const me = await requirePermission("facilities.edit");
  const { id, floorId } = await params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(floorId)) notFound();
  await requireFacilityAccess(Number(id), me);
  const [fl] = await db.select({
    id: floors.id, name: floors.name, level: floors.level, planWidth: floors.planWidth, planHeight: floors.planHeight, planImageUrl: floors.planImageUrl,
    buildingName: buildings.name, facilityId: facilities.id, facilityName: facilities.name,
  }).from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .where(and(eq(floors.id, Number(floorId)), eq(facilities.id, Number(id))));
  if (!fl) notFound();
  const [roomRows, depts] = await Promise.all([
    db.select({
      id: rooms.id, code: rooms.code, name: rooms.name, type: rooms.type, departmentId: rooms.departmentId, beds: rooms.beds,
      x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h,
      assetCount: sql<number>`(select count(*) from assets a where a.room_id = ${sql.raw('"rooms"."id"')})::int`,
    }).from(rooms).where(eq(rooms.floorId, fl.id)).orderBy(asc(rooms.code)),
    db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(eq(departments.facilityId, fl.facilityId)).orderBy(asc(departments.name)),
  ]);
  // Same colours as the floor map: departments on this floor first (by id), then the rest.
  const tints = deptTintMap(roomRows.map((r) => r.departmentId));
  let next = tints.size;
  for (const d of depts) if (!tints.has(d.id)) tints.set(d.id, DEPT_TINTS[next++ % DEPT_TINTS.length]);
  return (
    <>
      <PageHeader
        title={`Room layout — ${fl.name}`}
        description={<>{fl.buildingName} · {fl.facilityName}. {fl.planImageUrl ? "Trace the rooms over the plan image." : "Upload a plan image on the floor to trace over it, or sketch the rooms on the grid."}</>}
        back={{ href: `/facilities/${fl.facilityId}?tab=rooms&floorId=${fl.id}`, label: "Rooms" }}
        actions={<>
          <LinkButton href={`/facilities/${fl.facilityId}?tab=buildings&edit=floor-${fl.id}#floor-form`}>{fl.planImageUrl ? "Change plan image" : "Upload plan image"}</LinkButton>
          <LinkButton href={`/assets/map?floorId=${fl.id}`}>Open floor map</LinkButton>
        </>}
      />
      <LayoutEditor
        floor={{ id: fl.id, name: fl.name, level: fl.level, planWidth: fl.planWidth, planHeight: fl.planHeight, planImageUrl: fl.planImageUrl }}
        rooms={roomRows}
        departments={depts.map((d) => ({ ...d, tint: tints.get(d.id) ?? "var(--color-muted)" }))}
        roomTypes={[...ROOM_TYPES]}
        save={saveFloorLayout}
      />
    </>
  );
}

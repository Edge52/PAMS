import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, buildings, facilities, floors, rooms } from "@/db/schema";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { FloorMap, type MapDept } from "@/components/assets/floor-map";
import { floorMapData, floorsWithCounts } from "@/lib/assets/queries";
import { deptTintMap } from "@/lib/assets/visuals";
import { cx } from "@/components/ui";
import { moveAssetOnMap } from "./actions";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { scopeWhere, type Scope } from "@/lib/assets/access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Floor map" };

const idParam = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d+$/.test(s) ? Number(s) : null;
};

/** Deep links (asset/room/floor) resolve to their floor — access is checked by the caller; the default only picks floors in scope. */
async function resolveFloor(sp: { floorId: number | null; roomId: number | null; assetId: number | null; facilityId: number | null }, scope: Scope) {
  let note: string | null = null;
  if (sp.assetId) {
    const [a] = await db.select({ floorId: rooms.floorId, tag: assets.assetTag }).from(assets).leftJoin(rooms, eq(rooms.id, assets.roomId))
      .where(and(eq(assets.id, sp.assetId), scopeWhere(assets.facilityId, scope)));
    if (a?.floorId) return { floorId: a.floorId, note };
    note = a ? `${a.tag} is not in a room yet, so it isn't on any plan. Move it into a room from its asset page.` : "That asset was not found.";
  }
  if (sp.roomId) {
    const [r] = await db.select({ floorId: rooms.floorId }).from(rooms).where(eq(rooms.id, sp.roomId));
    if (r) return { floorId: r.floorId, note };
  }
  if (sp.floorId) {
    const [f] = await db.select({ id: floors.id }).from(floors).where(eq(floors.id, sp.floorId));
    if (f) return { floorId: f.id, note };
  }
  // Default: ground floor (or lowest non-basement) of the first facility.
  const all = await db.select({ id: floors.id, level: floors.level }).from(floors)
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).innerJoin(facilities, eq(facilities.id, buildings.facilityId))
    .where(and(sp.facilityId ? eq(facilities.id, sp.facilityId) : undefined, scopeWhere(facilities.id, scope)))
    .orderBy(asc(facilities.id), asc(buildings.code), asc(floors.level));
  const pick = all.find((f) => f.level >= 0) ?? all[0];
  return { floorId: pick?.id ?? null, note };
}

export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePermission("assets.view");
  const scope = await facilityScope(me);
  const sp = await searchParams;
  const q = { floorId: idParam(sp.floorId), roomId: idParam(sp.roomId), assetId: idParam(sp.assetId), facilityId: idParam(sp.facilityId) };
  if (q.facilityId) await requireFacilityAccess(q.facilityId, me);
  const { floorId, note } = await resolveFloor(q, scope);
  const canLayout = can(me.role, "facilities.edit");

  if (!floorId) {
    return (
      <>
        <PageHeader title="Floor map" description="See every device on every floor, room by room." />
        {canLayout ? (
          <EmptyState title="No floors to show yet" action={<LinkButton href="/facilities" variant="primary">Set up a facility</LinkButton>}>
            Add a facility with buildings, floors and rooms. Equipment placed in rooms then appears on the plan.
          </EmptyState>
        ) : (
          <EmptyState title="No floors to show yet">
            {scope && scope.length === 0 ? "Your account isn't linked to any facility yet. Ask an administrator to give you access to one." : "None of your facilities has floors yet. A biomedical engineer sets up floors and rooms."}
          </EmptyState>
        )}
      </>
    );
  }

  const data = await floorMapData(floorId);
  if (!data) return <EmptyState title="Floor not found" action={<LinkButton href="/assets/map">Open the default floor</LinkButton>} />;
  await requireFacilityAccess(data.floor.facilityId, me);
  const switcher = await floorsWithCounts(data.floor.facilityId);
  const facilityList = await db.select({ id: facilities.id, name: facilities.name, code: facilities.code }).from(facilities)
    .where(scopeWhere(facilities.id, scope)).orderBy(asc(facilities.code));

  const deptRows = new Map<number, MapDept>();
  const tints = deptTintMap(data.rooms.map((r) => r.departmentId));
  for (const r of data.rooms) {
    if (r.departmentId == null || deptRows.has(r.departmentId)) continue;
    deptRows.set(r.departmentId, { id: r.departmentId, code: r.departmentCode ?? "", name: r.departmentName ?? "", nameAr: r.departmentNameAr, tint: tints.get(r.departmentId) ?? "var(--color-muted)" });
  }
  const departmentsOnFloor = [...deptRows.values()];
  const unplaced = data.unplaced.flatMap((u) => (u.departmentId != null ? [{ departmentId: u.departmentId, name: deptRows.get(u.departmentId)?.name ?? "Department", n: u.n }] : []));

  const buildingsList = [...new Map(switcher.map((f) => [f.buildingId, f.buildingName])).entries()];
  const f = data.floor;

  return (
    <>
      <PageHeader
        title="Floor map"
        description={<>Every device, room by room — <b className="text-ink">{f.facilityName}</b>.</>}
        actions={<>
          <LinkButton href={`/assets?floorId=${f.id}`}>Open in register</LinkButton>
          {canLayout && <LinkButton href={`/facilities/${f.facilityId}/floors/${f.id}/layout`}>Edit room layout</LinkButton>}
        </>}
      />
      {note && <p role="status" className="mb-3 rounded-[var(--radius-control)] border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">{note}</p>}

      <nav aria-label="Floors" className="mb-3 space-y-2">
        {facilityList.length > 1 && (
          <div className="flex flex-wrap gap-1 text-sm">
            {facilityList.map((fa) => (
              <Link key={fa.id} href={`/assets/map?facilityId=${fa.id}`} aria-current={fa.id === f.facilityId ? "page" : undefined}
                className={cx("rounded px-2 py-0.5", fa.id === f.facilityId ? "bg-ink text-surface" : "text-muted hover:text-ink")}>{fa.code}</Link>
            ))}
          </div>
        )}
        {buildingsList.map(([bid, bname]) => (
          <div key={bid} className="flex items-center gap-2 overflow-x-auto pb-0.5">
            {buildingsList.length > 1 && <span className="shrink-0 text-xs font-semibold text-muted">{bname}</span>}
            <div className="flex gap-1 rounded-[var(--radius-control)] border border-line bg-surface p-1">
              {switcher.filter((x) => x.buildingId === bid).sort((a, b) => b.level - a.level).map((x) => (
                <Link key={x.id} href={`/assets/map?floorId=${x.id}`} aria-current={x.id === f.id ? "page" : undefined}
                  className={cx("flex shrink-0 items-baseline gap-1.5 rounded px-2.5 py-1 text-sm whitespace-nowrap",
                    x.id === f.id ? "bg-primary font-semibold text-white" : "text-ink hover:bg-sunken")}>
                  <span className="font-mono text-xs opacity-80">{x.level < 0 ? `B${-x.level}` : x.level === 0 ? "G" : x.level}</span>
                  {x.name}
                  <span className={cx("text-xs", x.id === f.id ? "text-white/80" : "text-muted")}>{x.assetCount}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {data.rooms.length === 0 ? (
        <EmptyState title="This floor has no rooms yet"
          action={canLayout ? <LinkButton href={`/facilities/${f.facilityId}/floors/${f.id}/layout`} variant="primary">Draw the rooms</LinkButton> : undefined}>
          {canLayout ? "Trace the rooms over the floor plan in the layout editor, then place equipment in them." : "Rooms are drawn by a biomedical engineer in the layout editor."}
        </EmptyState>
      ) : (
        <FloorMap
          key={f.id}
          floor={{ id: f.id, name: f.name, level: f.level, planWidth: f.planWidth, planHeight: f.planHeight, planImageUrl: f.planImageUrl, buildingName: f.buildingName, facilityName: f.facilityName }}
          rooms={data.rooms.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, beds: r.beds, x: r.x, y: r.y, w: r.w, h: r.h, departmentId: r.departmentId, polygon: r.polygon ?? null }))}
          assets={data.assets.map((a) => ({ ...a, roomId: a.roomId as number }))}
          departments={departmentsOnFloor}
          unplaced={unplaced}
          focusRoomId={q.roomId}
          focusAssetId={q.assetId}
          moveAction={moveAssetOnMap}
          canMove={can(me.role, "assets.move")}
          canAdd={can(me.role, "assets.edit")}
        />
      )}
    </>
  );
}

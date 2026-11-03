import "server-only";
/**
 * Walking routes on the server (wave 8): the same RouteService the 3D view uses, built from the database, so pathway
 * checks, coverage figures and the workshop route don't need a browser. One service per hospital, kept for a few
 * minutes and rebuilt when its fixes, zones, lifts or drawings change.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { buildings, deviceTypes, floorCad, floors, liftCores, routeFixes, rooms } from "@/db/schema";
import { buildingChecks, placeRoom, type CheckStep } from "./route-checks";
import type { Link, Step } from "./model";
import { rectPoly } from "@/components/assets/twin/geometry";
import { RouteService } from "@/components/assets/twin/nav/service";
import type { FloorGeometry, TwinData } from "@/components/assets/twin/types";

const FLOOR_TO_FLOOR_M = 5;
const TTL_MS = 5 * 60_000;
const cache = new Map<number, { at: number; sig: string; svc: RouteService; data: TwinData }>();

/** A cheap fingerprint of what the networks are built from. */
async function signature(facilityId: number): Promise<string> {
  const r = await db.execute<{ s: string }>(sql`select concat_ws('|',
    (select count(*) || ':' || coalesce(max(f.id), 0) from route_fixes f join floors fl on fl.id = f.floor_id join buildings b on b.id = fl.building_id where b.facility_id = ${facilityId}),
    (select coalesce(max(extract(epoch from l.updated_at)), 0) || ':' || count(*) from lift_cores l where l.facility_id = ${facilityId}),
    (select count(*) || ':' || coalesce(sum(length(coalesce(r.zone::text, ''))), 0) || ':' || coalesce(max(r.id), 0) from rooms r join floors fl on fl.id = r.floor_id join buildings b on b.id = fl.building_id where b.facility_id = ${facilityId})
  ) as s`);
  return String(r.rows[0]?.s ?? "");
}

export async function routeServiceFor(facilityId: number): Promise<{ svc: RouteService; data: TwinData }> {
  const sig = await signature(facilityId);
  const hit = cache.get(facilityId);
  if (hit && hit.sig === sig && Date.now() - hit.at < TTL_MS) return hit;
  const fl = await db.select({ f: floors, buildingName: buildings.name, hasCad: sql<boolean>`exists(select 1 from ${floorCad} where ${floorCad.floorId} = ${floors.id})` })
    .from(floors).innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(eq(buildings.facilityId, facilityId)).orderBy(asc(floors.level));
  const floorIds = fl.map((r) => r.f.id);
  const rs = floorIds.length ? await db.select().from(rooms).where(inArray(rooms.floorId, floorIds)) : [];
  const data: TwinData = {
    facility: { id: facilityId, name: "", code: "" },
    can: { report: false, move: false, maintain: false, addAsset: false },
    facilities: [],
    floors: fl.map(({ f, buildingName, hasCad }) => ({
      id: f.id, name: f.name, level: f.level, buildingName, elevation: f.elevation ?? f.level * FLOOR_TO_FLOOR_M,
      planWidth: f.planWidth, planHeight: f.planHeight, unitsPerMetre: f.unitsPerMetre ?? 10, hasCad: Boolean(hasCad),
    })),
    rooms: rs.filter((r) => r.type !== "CORRIDOR" || r.polygon).map((r) => ({
      id: r.id, floorId: r.floorId, code: r.code, name: r.name, type: r.type, departmentId: r.departmentId, zone: r.zone,
      poly: r.polygon && r.polygon.length >= 3 ? r.polygon : rectPoly(r.x, r.y, r.w, r.h),
    })),
    departments: [], assets: [], unplaced: [],
    fixes: floorIds.length ? (await db.select().from(routeFixes).where(inArray(routeFixes.floorId, floorIds)))
      .map((f) => ({ id: f.id, floorId: f.floorId, kind: f.kind, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, note: f.note, by: f.createdByName })) : [],
    lifts: (await db.select().from(liftCores).where(eq(liftCores.facilityId, facilityId)))
      .map((l) => ({ id: l.id, name: l.name, kind: l.kind, inferred: l.inferred, cars: l.cars, waitByHour: l.waitByHour ?? null, waitSeconds: l.waitSeconds, stops: l.stops.filter((st) => floorIds.includes(st.floorId)) })),
  };
  const svc = new RouteService(data, async (floorId): Promise<FloorGeometry | null> => {
    const [g] = await db.select({ walls: floorCad.walls, doors: floorCad.doors, glass: floorCad.glass, columns: floorCad.columns }).from(floorCad).where(eq(floorCad.floorId, floorId));
    return g ? { walls: g.walls ?? [], doors: g.doors ?? [], glass: g.glass ?? [], columns: g.columns ?? [] } : null;
  });
  const entry = { at: Date.now(), sig, svc, data };
  cache.set(facilityId, entry);
  return entry;
}

/** Building checks for a pathway (route-checks.ts) with this hospital's routes, catalogue and the pathway's busiest hour. */
export async function pathwayBuildingIssues(facilityId: number, steps: CheckStep[], links: Link[], arrivalProfile: number[] | null) {
  const { svc, data } = await routeServiceFor(facilityId);
  const codes = new Set((await db.select({ code: deviceTypes.code }).from(deviceTypes)).map((r) => r.code));
  const hour = arrivalProfile?.length === 24 ? arrivalProfile.indexOf(Math.max(...arrivalProfile)) : null;
  const upm = new Map(data.floors.map((f) => [f.id, f.unitsPerMetre || 10]));
  return buildingChecks(steps, links, data.rooms, svc, { catalogue: codes, hour, unitsPerMetre: (id) => upm.get(id) ?? 10 });
}

/** Each arrow's route (metres, seconds, lifts) for a pathway, at its busiest hour: for the sheet and the book. */
export async function pathwayRoutes(facilityId: number, flow: { steps: Step[]; links: Link[]; arrivalProfile: number[] | null }) {
  const { svc, data } = await routeServiceFor(facilityId);
  const hour = flow.arrivalProfile?.length === 24 ? flow.arrivalProfile.indexOf(Math.max(...flow.arrivalProfile)) : null;
  return Promise.all(flow.links.map(async (l) => {
    const a = flow.steps.find((s) => s.key === l.fromKey), b = flow.steps.find((s) => s.key === l.toKey);
    const ra = a ? placeRoom(a, data.rooms) : null, rb = b ? placeRoom(b, data.rooms) : null;
    if (!ra || !rb) return null;
    const [pa, pb] = await Promise.all([svc.roomPlace(ra.id), svc.roomPlace(rb.id)]);
    return pa && pb ? svc.route(pa, pb, l.transport === "BED" || l.transport === "TROLLEY" ? "bed" : l.transport === "WHEELCHAIR" ? "wheelchair" : "foot", hour) : null;
  }));
}

/** Everything the printable sheet needs for one pathway. */
export async function pathwaySheetData(flowId: number): Promise<import("@/components/flows/pathway-sheet").SheetData | null> {
  const { loadFlow, equipmentNames } = await import("./server");
  const { readiness } = await import("./readiness");
  const { checkFlow } = await import("./model");
  const { facilities, assets } = await import("@/db/schema");
  const f = await loadFlow(flowId); if (!f) return null;
  const { data } = await routeServiceFor(f.flow.facilityId);
  const [fac] = await db.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, f.flow.facilityId));
  const routes = await pathwayRoutes(f.flow.facilityId, { steps: f.steps, links: f.links, arrivalProfile: f.flow.arrivalProfile });
  const kit = await db.select({ id: assets.id, typeCode: deviceTypes.code, typeName: deviceTypes.name, roomId: assets.roomId, status: assets.status })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId))
    .where(sql`${assets.facilityId} = ${f.flow.facilityId} and ${assets.status} <> 'DISPOSED' and ${assets.roomId} is not null`);
  const structural = checkFlow(f.steps, f.links);
  const building = structural.some((i) => i.level === "error") ? [] : await pathwayBuildingIssues(f.flow.facilityId, f.steps, f.links, f.flow.arrivalProfile).catch(() => []);
  const deptName = new Map((await db.execute<{ id: number; name: string }>(sql`select id, name from departments where facility_id = ${f.flow.facilityId}`)).rows.map((r) => [Number(r.id), String(r.name)]));
  const placeOf: Record<string, string | null> = {};
  for (const s of f.steps) {
    const r = s.roomId != null ? data.rooms.find((x) => x.id === s.roomId) : null;
    placeOf[s.key] = r ? `${r.name} · ${data.floors.find((x) => x.id === r.floorId)?.name ?? ""}` : s.departmentId != null ? deptName.get(s.departmentId) ?? null : null;
  }
  return {
    flow: { ...f.flow, kind: f.flow.kind }, facility: fac?.name ?? "", steps: f.steps, links: f.links, routes, placeOf,
    readiness: readiness(f.steps, data.rooms, kit, undefined, await equipmentNames(f.steps.flatMap((s) => s.equipment))),
    issues: [...structural, ...building],
  };
}

/** The walking route from the nearest biomedical workshop room to a room (work orders, wave 8 A4). */
export async function workshopRoute(facilityId: number, toRoomId: number) {
  const { svc, data } = await routeServiceFor(facilityId);
  const ws = await db.select({ id: rooms.id, name: rooms.name }).from(rooms).innerJoin(floors, eq(floors.id, rooms.floorId))
    .innerJoin(buildings, eq(buildings.id, floors.buildingId)).where(sql`${buildings.facilityId} = ${facilityId} and ${rooms.workshop}`);
  if (!ws.length || !data.rooms.some((r) => r.id === toRoomId)) return { workshops: ws.length, best: null };
  const to = await svc.roomPlace(toRoomId); if (!to) return { workshops: ws.length, best: null };
  let best: { from: { id: number; name: string }; route: NonNullable<Awaited<ReturnType<typeof svc.route>>> } | null = null;
  for (const w of ws) {
    const from = await svc.roomPlace(w.id); if (!from) continue;
    const r = await svc.route(from, to, "foot", new Date().getHours());
    if (r && (!best || r.seconds < best.route.seconds)) best = { from: w, route: r };
  }
  return { workshops: ws.length, best };
}

/** Walking network figures per floor for the Facilities page (wave 8, A5). */
export async function networkCoverage(facilityId: number, rebuild = false) {
  if (rebuild) cache.delete(facilityId);
  const { svc, data } = await routeServiceFor(facilityId);
  const out: { floorId: number; floor: string; level: number; counted: number; reached: number; share: number; assumed: number; unreachable: { id: number; name: string }[] }[] = [];
  for (const f of [...data.floors].sort((a, b) => b.level - a.level)) {
    if (!data.rooms.some((r) => r.floorId === f.id)) continue;
    const c = await svc.coverage(f.id); const net = await svc.network(f.id);
    if (!c || !net) continue;
    out.push({ floorId: f.id, floor: f.name, level: f.level, counted: c.counted, reached: c.reached, share: c.share, assumed: c.assumed,
      unreachable: net.unreachable.map((id) => ({ id, name: data.rooms.find((r) => r.id === id)?.name ?? `Room ${id}` })) });
  }
  return out;
}

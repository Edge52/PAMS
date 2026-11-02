/**
 * Walking routes in the 3D view (wave 7, step 7a): builds each floor's network on first use from the floor's
 * drawing, and routes between rooms or spots with the hospital's declared lifts and its stairs. Client side.
 */
import { interiorPoint, type Pt } from "../geometry";
import type { FloorGeometry, TwinData } from "../types";
import type { Journey } from "../../../../lib/assets/lifts";
import { buildNetwork, coverage, type NavRoom, type Network } from "./network";
import { joinRoutes, route, stairsFrom, type LiftLink, type Place, type Route, type RouteWorld } from "./route";

export class RouteService {
  private nets = new Map<number, Network>();
  private pending = new Map<number, Promise<Network | null>>();
  private lifts: LiftLink[];
  private stairs;

  constructor(private data: TwinData, private loadGeometry: (floorId: number) => Promise<FloorGeometry | null>) {
    const s = (floorId: number) => 1 / (data.floors.find((f) => f.id === floorId)?.unitsPerMetre || 10);
    this.lifts = data.lifts.map((l) => ({
      id: l.id, name: l.name, kind: l.kind, waitSeconds: 45,
      stops: new Map(l.stops.map((st) => [st.floorId, [st.x * s(st.floorId), st.y * s(st.floorId)] as Pt])),
    }));
    this.stairs = stairsFrom(data.rooms.filter((r) => /\bstair/i.test(r.name) && r.poly.length >= 3).map((r) => {
      const [x, y] = interiorPoint(r.poly as Pt[]); return { floorId: r.floorId, name: r.name, at: [x * s(r.floorId), y * s(r.floorId)] as Pt };
    }));
  }

  private roomsOn(floorId: number): NavRoom[] {
    const s = 1 / (this.data.floors.find((f) => f.id === floorId)?.unitsPerMetre || 10);
    return this.data.rooms.filter((r) => r.floorId === floorId && r.poly.length >= 3).map((r) => ({ id: r.id, name: r.name, poly: r.poly.map(([x, y]) => [x * s, y * s] as Pt) }));
  }

  /** The floor's network, built once. */
  async network(floorId: number): Promise<Network | null> {
    const hit = this.nets.get(floorId); if (hit) return hit;
    const p = this.pending.get(floorId); if (p) return p;
    const job = (async () => {
      const f = this.data.floors.find((x) => x.id === floorId); if (!f) return null;
      const g = await this.loadGeometry(floorId);
      const s = 1 / (f.unitsPerMetre || 10);
      const segs = g ? [...g.walls, ...(g.glass ?? []), ...(g.columns ?? [])].map((v) => v * s) : [];
      // Floors drawn by hand have no wall lines: their room outlines are the walls.
      const rooms = this.roomsOn(floorId);
      const walls = segs.length ? segs : rooms.flatMap((r) => r.poly.flatMap((p, i) => [...p, ...r.poly[(i + 1) % r.poly.length]]));
      const net = buildNetwork(floorId, walls, rooms);
      this.nets.set(floorId, net);
      return net;
    })();
    this.pending.set(floorId, job);
    return job;
  }

  async coverage(floorId: number) {
    const n = await this.network(floorId);
    return n ? { ...coverage(n, this.roomsOn(floorId)), assumed: n.assumed.length, unreachable: n.unreachable.length } : null;
  }

  /** Where a room is entered (metres). */
  async roomPlace(roomId: number): Promise<Place | null> {
    const r = this.data.rooms.find((x) => x.id === roomId); if (!r) return null;
    const n = await this.network(r.floorId); const e = n?.rooms.get(roomId);
    if (e) return { floorId: r.floorId, x: e.x, z: e.z, roomId };
    const s = 1 / (this.data.floors.find((f) => f.id === r.floorId)?.unitsPerMetre || 10);
    const [x, y] = interiorPoint(r.poly as Pt[]);
    return { floorId: r.floorId, x: x * s, z: y * s, roomId };
  }

  private world(): RouteWorld {
    return {
      network: (id) => this.nets.get(id) ?? null,
      level: (id) => this.data.floors.find((f) => f.id === id)?.level ?? 0,
      lifts: this.lifts, stairs: this.stairs,
    };
  }

  async route(a: Place, b: Place, journey: Journey): Promise<Route | null> {
    await Promise.all([this.network(a.floorId), this.network(b.floorId)]);
    return route(this.world(), a, b, journey);
  }

  /** A route through several rooms in order (a pathway's steps). */
  async through(roomIds: number[], journey: Journey): Promise<{ route: Route; legs: Route[] } | null> {
    const places = await Promise.all(roomIds.map((id) => this.roomPlace(id)));
    if (places.some((p) => !p)) return null;
    const legs: Route[] = [];
    for (let i = 1; i < places.length; i++) {
      const r = await this.route(places[i - 1]!, places[i]!, journey);
      if (!r) return null;
      legs.push(r);
    }
    return { route: joinRoutes(legs), legs };
  }
}

/** Points to draw (scene.showRoute): walk legs as their bends, floor changes handled by the scene. */
export function routeSpots(r: Route): { floorId: number; x: number; z: number }[] {
  const out: { floorId: number; x: number; z: number }[] = [];
  for (const l of r.legs) {
    if (l.kind === "walk") for (const [x, z] of l.points) out.push({ floorId: l.floorId, x, z });
    else { out.push({ floorId: l.floorId, x: l.points[0][0], z: l.points[0][1] }); out.push({ floorId: l.toFloorId!, x: l.points[1][0], z: l.points[1][1] }); }
  }
  return out;
}

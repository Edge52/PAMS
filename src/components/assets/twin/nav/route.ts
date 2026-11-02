/**
 * Walking routes (wave 7, step 7a): shortest routes on a floor's network and across floors. Pure; metres.
 *
 * - On a floor: A* over the walkable grid (8 directions, no cutting corners), never through a sterile room unless the
 *   route starts or ends in it; the cell path is then straightened into the fewest straight runs that stay walkable.
 * - Across floors: by each lift the journey may use (beds by bed lifts only; people on foot or in wheelchairs by
 *   public or bed lifts; never AGV lifts), or by stairs on foot; the quickest wins.
 * - Time: walking pace by journey, plus lift wait (per lift) and travel per storey.
 * - Where no route exists (a room not on the network), the leg is the straight line, marked estimated.
 */
import type { Pt } from "../geometry";
import { liftAllowed, type Journey, type LiftKind } from "../../../../lib/assets/lifts";
import type { Network } from "./network";

export const PACE: Record<Journey, number> = { foot: 1.2, wheelchair: 0.8, bed: 0.6, supplies: 0.9, agv: 0.8 };
/** Seconds per storey in a lift (travel and doors), and on stairs on foot. */
export const LIFT_STOREY_S = 8, STAIR_STOREY_S = 15;

export type Place = { floorId: number; x: number; z: number; roomId?: number | null };
export type Leg = { floorId: number; kind: "walk" | "lift" | "stairs"; points: Pt[]; metres: number; seconds: number; estimated?: boolean; via?: string; toFloorId?: number };
export type Route = { legs: Leg[]; metres: number; seconds: number; floorChanges: number; liftTrips: number; estimated: boolean };

export type LiftLink = { id: number; name: string; kind: LiftKind; waitSeconds: number; stops: Map<number, Pt> };
export type StairLink = { name: string; stops: Map<number, Pt> };

/* ── On one floor ── */

class Heap {
  private a: number[] = []; private f: number[] = [];
  get size() { return this.a.length; }
  push(i: number, f: number) {
    this.a.push(i); this.f.push(f);
    let k = this.a.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (this.f[p] <= this.f[k]) break; this.swap(k, p); k = p; }
  }
  pop(): number {
    const top = this.a[0], last = this.a.pop()!, lf = this.f.pop()!;
    if (this.a.length) {
      this.a[0] = last; this.f[0] = lf;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < this.a.length && this.f[l] < this.f[m]) m = l;
        if (r < this.a.length && this.f[r] < this.f[m]) m = r;
        if (m === k) break; this.swap(k, m); k = m;
      }
    }
    return top;
  }
  private swap(i: number, j: number) { [this.a[i], this.a[j]] = [this.a[j], this.a[i]]; [this.f[i], this.f[j]] = [this.f[j], this.f[i]]; }
}

const cellOf = (n: Network, x: number, z: number) => {
  const cx = Math.floor((x - n.x0) / n.cell), cz = Math.floor((z - n.z0) / n.cell);
  return cx >= 0 && cx < n.w && cz >= 0 && cz < n.h ? cz * n.w + cx : -1;
};
const centreOf = (n: Network, i: number): Pt => [n.x0 + ((i % n.w) + 0.5) * n.cell, n.z0 + (Math.floor(i / n.w) + 0.5) * n.cell];

/** Nearest walkable cell on the network to a point (within `maxM`). */
export function snap(n: Network, x: number, z: number, maxM = 4): number {
  const c = cellOf(n, x, z);
  if (c >= 0 && n.free[c] && n.comp[c] === n.main) return c;
  const r = Math.ceil(maxM / n.cell);
  const cx0 = Math.floor((x - n.x0) / n.cell), cz0 = Math.floor((z - n.z0) / n.cell);
  let best = -1, bd = Infinity;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const cx = cx0 + dx, cz = cz0 + dz; if (cx < 0 || cz < 0 || cx >= n.w || cz >= n.h) continue;
    const i = cz * n.w + cx; if (!n.free[i] || n.comp[i] !== n.main) continue;
    const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** A* between two cells; `allow` are sterile rooms the route may enter (its own start and end rooms). */
export function astar(n: Network, s: number, t: number, allow: Set<number> = new Set()): number[] | null {
  if (s < 0 || t < 0) return null;
  if (s === t) return [s];
  const N = n.w * n.h, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const tx = t % n.w, tz = Math.floor(t / n.w);
  const hcost = (i: number) => { const dx = Math.abs((i % n.w) - tx), dz = Math.abs(Math.floor(i / n.w) - tz); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
  const ok = (i: number) => n.free[i] === 1 && (n.zone[i] === 0 || allow.has(n.zone[i]));
  const heap = new Heap(); g[s] = 0; heap.push(s, hcost(s));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue; done[i] = 1;
    if (i === t) break;
    const x = i % n.w, z = Math.floor(i / n.w);
    for (const [dx, dz, c] of D) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= n.w || nz >= n.h) continue;
      const j = nz * n.w + nx; if (done[j] || !ok(j)) continue;
      if (dx && dz && (!ok(z * n.w + nx) || !ok(nz * n.w + x))) continue; // no corner cutting
      const ng = g[i] + c;
      if (ng < g[j]) { g[j] = ng; from[j] = i; heap.push(j, ng + hcost(j)); }
    }
  }
  if (from[t] < 0) return null;
  const path: number[] = [];
  for (let i = t; i >= 0; i = i === s ? -1 : from[i]) path.push(i);
  return path.reverse();
}

/** Is the straight line between two cells walkable (and outside sterile rooms not allowed)? */
function clear(n: Network, a: number, b: number, allow: Set<number>): boolean {
  const ax = a % n.w, az = Math.floor(a / n.w), bx = b % n.w, bz = Math.floor(b / n.w);
  const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2);
  for (let k = 0; k <= steps; k++) {
    const t = steps ? k / steps : 0;
    const x = Math.round(ax + (bx - ax) * t), z = Math.round(az + (bz - az) * t);
    const i = z * n.w + x;
    if (!n.free[i] || (n.zone[i] && !allow.has(n.zone[i]))) return false;
  }
  return true;
}

/** Straighten a cell path: keep only the turning points needed to stay walkable. */
export function straighten(n: Network, path: number[], allow: Set<number> = new Set()): Pt[] {
  if (path.length <= 2) return path.map((i) => centreOf(n, i));
  const out: number[] = [path[0]];
  let k = 0;
  while (k < path.length - 1) {
    let far = k + 1;
    // Furthest point still visible (looking ahead at most 400 cells keeps it fast).
    for (let j = Math.min(path.length - 1, k + 400); j > k + 1; j--) if (clear(n, path[k], path[j], allow)) { far = j; break; }
    out.push(path[far]); k = far;
  }
  return out.map((i) => centreOf(n, i));
}

const length = (pts: Pt[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** Route between two points on one floor. Falls back to the straight line (estimated) when either end is off the network. */
export function floorRoute(n: Network, a: Place, b: Place, journey: Journey): Leg {
  const allow = new Set<number>([a.roomId, b.roomId].filter((v): v is number => v != null));
  const s = snap(n, a.x, a.z), t = snap(n, b.x, b.z);
  const path = astar(n, s, t, allow);
  if (!path) {
    const pts: Pt[] = [[a.x, a.z], [b.x, b.z]];
    const m = length(pts);
    return { floorId: n.floorId, kind: "walk", points: pts, metres: m, seconds: m / PACE[journey], estimated: true };
  }
  const pts: Pt[] = [[a.x, a.z], ...straighten(n, path, allow), [b.x, b.z]];
  const m = length(pts);
  return { floorId: n.floorId, kind: "walk", points: pts, metres: m, seconds: m / PACE[journey] };
}

/* ── Across floors ── */

export type RouteWorld = {
  network: (floorId: number) => Network | null;
  level: (floorId: number) => number;
  lifts: LiftLink[];
  stairs: StairLink[];
};

export function route(world: RouteWorld, a: Place, b: Place, journey: Journey): Route | null {
  const na = world.network(a.floorId), nb = world.network(b.floorId);
  if (!na || !nb) return null;
  if (a.floorId === b.floorId) return summarise([floorRoute(na, a, b, journey)]);
  const storeys = Math.abs(world.level(a.floorId) - world.level(b.floorId));
  const options: Leg[][] = [];
  for (const l of world.lifts) {
    if (!liftAllowed(l.kind, journey)) continue;
    const p = l.stops.get(a.floorId), q = l.stops.get(b.floorId); if (!p || !q) continue;
    const up = floorRoute(na, a, { floorId: a.floorId, x: p[0], z: p[1] }, journey);
    const down = floorRoute(nb, { floorId: b.floorId, x: q[0], z: q[1] }, b, journey);
    const ride: Leg = { floorId: a.floorId, toFloorId: b.floorId, kind: "lift", points: [p, q], metres: 0, seconds: l.waitSeconds + storeys * LIFT_STOREY_S, via: l.name };
    options.push([up, ride, down]);
  }
  if (journey === "foot") for (const st of world.stairs) {
    const p = st.stops.get(a.floorId), q = st.stops.get(b.floorId); if (!p || !q) continue;
    const up = floorRoute(na, a, { floorId: a.floorId, x: p[0], z: p[1] }, journey);
    const down = floorRoute(nb, { floorId: b.floorId, x: q[0], z: q[1] }, b, journey);
    options.push([up, { floorId: a.floorId, toFloorId: b.floorId, kind: "stairs", points: [p, q], metres: storeys * 7, seconds: storeys * STAIR_STOREY_S, via: st.name }, down]);
  }
  if (!options.length) return null;
  const score = (legs: Leg[]) => legs.reduce((s, l) => s + l.seconds, 0) + (legs.some((l) => l.estimated) ? 1e6 : 0);
  return summarise(options.sort((p, q) => score(p) - score(q))[0]);
}

/** Join consecutive routes (a pathway's legs) into one. */
export function joinRoutes(routes: Route[]): Route { return summarise(routes.flatMap((r) => r.legs)); }

function summarise(legs: Leg[]): Route {
  return {
    legs,
    metres: legs.reduce((s, l) => s + l.metres, 0),
    seconds: legs.reduce((s, l) => s + l.seconds, 0),
    floorChanges: legs.filter((l) => l.kind !== "walk").length,
    liftTrips: legs.filter((l) => l.kind === "lift").length,
    estimated: legs.some((l) => l.estimated),
  };
}

/** Stairs from room names, linked across floors by name ("Stair 2" on every floor) and position. */
export function stairsFrom(rooms: { floorId: number; name: string; at: Pt }[], maxApartM = 6): StairLink[] {
  const byName = new Map<string, { floorId: number; at: Pt }[]>();
  for (const r of rooms) {
    const m = /\bstair(?:case)?s?\s*(\w+)?/i.exec(r.name); if (!m) continue;
    const key = (m[1] ?? "").toLowerCase();
    (byName.get(key) ?? byName.set(key, []).get(key)!).push(r);
  }
  const out: StairLink[] = [];
  for (const [key, list] of byName) {
    // Group by position: same name and within a few metres means the same stair core.
    const groups: { floorId: number; at: Pt }[][] = [];
    for (const r of list) {
      const g = groups.find((gr) => !gr.some((x) => x.floorId === r.floorId) && Math.hypot(gr[0].at[0] - r.at[0], gr[0].at[1] - r.at[1]) <= maxApartM);
      if (g) g.push(r); else groups.push([r]);
    }
    for (const gr of groups) if (gr.length > 1) out.push({ name: `Stair ${key}`.trim(), stops: new Map(gr.map((r) => [r.floorId, r.at])) });
  }
  return out;
}

export const formatDuration = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/**
 * Walking routes (wave 7, step 7a): the walkable network of one floor. Pure; metres on the floor plane (x, z).
 *
 * Drawings give wall lines but no clean door openings, so routes run on a grid:
 * 1. Walls, glazing and columns are drawn onto a 25 cm grid and grown by one cell for clearance; what's left is
 *    walkable. Corridors and open areas come out on their own, without depending on room outlines touching.
 * 2. The main network is the connected walkable area holding most corridors and lobbies.
 * 3. A room the walls cut off from it (a door drawn closed, a gap missing in the drawing) gets an *assumed door*:
 *    the shortest opening, at most `doorMaxM` through a wall, to the network. Assumed doors are listed so they can be
 *    checked; a room that still can't be reached is listed as unreachable.
 * 4. Sterile and isolation rooms (theatres, scrub, airlocks, CSSD, cath and IR labs, NICU, isolation) are closed to
 *    through-traffic: a route may end in one, never pass through one.
 */
import { interiorPoint, pointInPolygon, polygonArea, type Pt } from "../geometry";
import { rasterise } from "../render/walls";

export type NavRoom = { id: number; name: string; poly: Pt[] };
export type Network = {
  floorId: number;
  w: number; h: number; cell: number; x0: number; z0: number;
  /** 1 = walkable. */
  free: Uint8Array;
  /** Connected area of each walkable cell (0 = none); `main` is the network. */
  comp: Int32Array; main: number;
  /** Cells closed to through-traffic → the sterile room they belong to. */
  zone: Int32Array;
  /** Where each room is entered (a walkable cell inside it, metres), and whether it's on the network. */
  rooms: Map<number, { x: number; z: number; cell: number; reached: boolean; name: string }>;
  /** Openings assumed through walls (metres, from room side to network side). */
  assumed: { roomId: number; a: Pt; b: Pt }[];
  unreachable: number[];
};

const HUB = /CORRIDOR|LOBBY|WAITING|RECEPTION|ALCOVE|HALL|ENTRANCE|PASSAGE/i;
const TECH = /ELEC|HVAC|SHAFT|DATA|PARTITION|DUCT|RISER|T\.R\.|R\.M\.U/i;
export const STERILE = /OPERATING|THEATRE|C-SECTION|\bOR\b|SCRUB|STERILE|CSSD|CLEAN CORE|AIR ?LOCK|CATH LAB|IR LAB|\bNICU\b|ISOLATION/i;

/** Rooms that count for coverage: everything except shafts, risers and electrical/data rooms. */
export const countsForCoverage = (name: string) => !TECH.test(name);

export function buildNetwork(floorId: number, segs: number[], rooms: NavRoom[], opts: { cell?: number; doorMaxM?: number } = {}): Network {
  const cell = opts.cell ?? 0.25, doorMax = opts.doorMaxM ?? 1.2;
  // Bounds from rooms and walls.
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const r of rooms) for (const [x, z] of r.poly) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
  for (let i = 0; i + 1 < segs.length; i += 2) { bx0 = Math.min(bx0, segs[i]); bx1 = Math.max(bx1, segs[i]); bz0 = Math.min(bz0, segs[i + 1]); bz1 = Math.max(bz1, segs[i + 1]); }
  if (!Number.isFinite(bx0)) { bx0 = 0; bx1 = 1; bz0 = 0; bz1 = 1; }
  const g = rasterise(segs, { x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, cell);
  const { w, h, x0, z0 } = g;
  // Clearance: grow walls by one cell (4-neighbourhood).
  const blocked = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const i = z * w + x;
    if (g.data[i] || (x > 0 && g.data[i - 1]) || (x < w - 1 && g.data[i + 1]) || (z > 0 && g.data[i - w]) || (z < h - 1 && g.data[i + w])) blocked[i] = 1;
  }
  const free = new Uint8Array(w * h);
  for (let i = 0; i < free.length; i++) free[i] = blocked[i] ? 0 : 1;
  // Only the building counts as walkable: cells inside a room, or within 1 m of one (the gaps between room outlines
  // are wall thickness or corridor pieces the drawing didn't outline); outside the building is not a corridor.
  let inside: Uint8Array = new Uint8Array(w * h);
  for (const r of rooms) fillPolygon(r.poly, w, h, x0, z0, cell, (i) => { inside[i] = 1; });
  inside = grow(inside, w, h, Math.max(1, Math.round(1 / cell)));
  for (let i = 0; i < free.length; i++) if (!inside[i]) free[i] = 0;

  const toCell = (x: number, z: number) => {
    const cx = Math.floor((x - x0) / cell), cz = Math.floor((z - z0) / cell);
    return cx >= 0 && cx < w && cz >= 0 && cz < h ? cz * w + cx : -1;
  };
  const centre = (i: number): Pt => [x0 + ((i % w) + 0.5) * cell, z0 + (Math.floor(i / w) + 0.5) * cell];

  const comp = label(free, w, h);

  // Each room's entry cell: its interior point, or the nearest walkable cell inside it.
  const entry = new Map<number, number>();
  for (const r of rooms) {
    if (r.poly.length < 3) continue;
    const [px, pz] = interiorPoint(r.poly);
    let best = -1, bd = Infinity;
    const c0 = toCell(px, pz);
    if (c0 >= 0 && free[c0] && pointInPolygon(centre(c0), r.poly)) best = c0;
    else {
      const rad = Math.ceil(3 / cell);
      const cx0 = Math.floor((px - x0) / cell), cz0 = Math.floor((pz - z0) / cell);
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const cx = cx0 + dx, cz = cz0 + dz; if (cx < 0 || cz < 0 || cx >= w || cz >= h) continue;
        const i = cz * w + cx; if (!free[i]) continue;
        const d = dx * dx + dz * dz; if (d >= bd) continue;
        if (!pointInPolygon(centre(i), r.poly)) continue;
        bd = d; best = i;
      }
    }
    if (best >= 0) entry.set(r.id, best);
  }

  // The network: the area holding most corridors and lobbies (by count, then by size).
  const votes = new Map<number, number>();
  for (const r of rooms) { const e = entry.get(r.id); if (e != null && HUB.test(r.name)) votes.set(comp[e], (votes.get(comp[e]) ?? 0) + 1); }
  const size = new Map<number, number>(); for (let i = 0; i < comp.length; i++) if (comp[i]) size.set(comp[i], (size.get(comp[i]) ?? 0) + 1);
  let main = 0;
  for (const c of size.keys()) if (!main || (votes.get(c) ?? 0) > (votes.get(main) ?? 0) || ((votes.get(c) ?? 0) === (votes.get(main) ?? 0) && size.get(c)! > size.get(main)!)) main = c;

  // Assumed doors: two passes, so a room behind an ante-room connects once the ante-room does.
  const assumed: Network["assumed"] = [];
  const reach = Math.ceil(doorMax / cell);
  // Areas joined to the network so far (merge table instead of relabelling the grid each time).
  const joined = new Map<number, number>();
  const area = (c: number) => { let x = c; while (joined.has(x)) x = joined.get(x)!; return x; };
  for (let pass = 0; pass < 2; pass++) {
    for (const r of rooms) {
      const e = entry.get(r.id); if (e == null || area(comp[e]) === main) continue;
      const own = area(comp[e]);
      // Cells of the room's own area inside (or within a cell of) the room, and the network's cells nearby.
      let bxa = Infinity, bxb = -Infinity, bza = Infinity, bzb = -Infinity;
      for (const [x, z] of r.poly) { bxa = Math.min(bxa, x); bxb = Math.max(bxb, x); bza = Math.min(bza, z); bzb = Math.max(bzb, z); }
      const ca = Math.max(0, Math.floor((bxa - x0) / cell) - reach), cb = Math.min(w - 1, Math.floor((bxb - x0) / cell) + reach);
      const za = Math.max(0, Math.floor((bza - z0) / cell) - reach), zb = Math.min(h - 1, Math.floor((bzb - z0) / cell) + reach);
      const mine: number[] = [], net: number[] = [];
      for (let cz = za; cz <= zb; cz++) for (let cx = ca; cx <= cb; cx++) {
        const i = cz * w + cx;
        const ar = comp[i] ? area(comp[i]) : 0;
        if (ar === own) mine.push(i); else if (ar === main) net.push(i);
      }
      if (!net.length) continue;
      let best: [number, number] | null = null, bd = (reach + 0.5) ** 2;
      for (const a of mine) {
        const ax = a % w, az = Math.floor(a / w);
        for (const b of net) {
          const dx = (b % w) - ax, dz = Math.floor(b / w) - az, d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = [a, b]; }
        }
      }
      if (!best) continue;
      // Carve the opening and join the room's area to the network.
      const [a, b] = best;
      const ax = a % w, az = Math.floor(a / w), bxx = b % w, bzz = Math.floor(b / w);
      const n = Math.max(Math.abs(bxx - ax), Math.abs(bzz - az));
      for (let k = 0; k <= n; k++) {
        const i = Math.round(az + ((bzz - az) * k) / Math.max(1, n)) * w + Math.round(ax + ((bxx - ax) * k) / Math.max(1, n));
        free[i] = 1;
      }
      joined.set(own, main);
      for (let k = 0; k <= n; k++) comp[Math.round(az + ((bzz - az) * k) / Math.max(1, n)) * w + Math.round(ax + ((bxx - ax) * k) / Math.max(1, n))] = main;
      assumed.push({ roomId: r.id, a: centre(a), b: centre(b) });
    }
  }

  for (let i = 0; i < comp.length; i++) if (comp[i]) comp[i] = area(comp[i]);

  // Sterile zones.
  const zone = new Int32Array(w * h);
  for (const r of rooms) if (STERILE.test(r.name)) fillPolygon(r.poly, w, h, x0, z0, cell, (i) => { zone[i] = r.id; });

  const out = new Map<number, { x: number; z: number; cell: number; reached: boolean; name: string }>();
  const unreachable: number[] = [];
  for (const r of rooms) {
    const e = entry.get(r.id);
    const reached = e != null && comp[e] === main;
    if (e != null) { const [x, z] = centre(e); out.set(r.id, { x, z, cell: e, reached, name: r.name }); }
    if (!reached && countsForCoverage(r.name) && polygonArea(r.poly) >= 1) unreachable.push(r.id);
  }
  return { floorId, w, h, cell, x0, z0, free, comp, main, zone, rooms: out, assumed, unreachable };
}

/** Share of rooms that count for coverage which are on the network. */
export function coverage(net: Network, rooms: NavRoom[]): { counted: number; reached: number; share: number } {
  const counted = rooms.filter((r) => countsForCoverage(r.name) && polygonArea(r.poly) >= 1);
  const reached = counted.filter((r) => net.rooms.get(r.id)?.reached).length;
  return { counted: counted.length, reached, share: counted.length ? reached / counted.length : 1 };
}

/** Grow set cells by r in every direction (square window, two 1-D passes with running counts). */
function grow(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) {
    let c = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) c += src[z * w + x];
    for (let x = 0; x < w; x++) {
      tmp[z * w + x] = c > 0 ? 1 : 0;
      if (x + r + 1 < w) c += src[z * w + x + r + 1];
      if (x - r >= 0) c -= src[z * w + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let z = 0; z <= Math.min(r, h - 1); z++) c += tmp[z * w + x];
    for (let z = 0; z < h; z++) {
      out[z * w + x] = c > 0 ? 1 : 0;
      if (z + r + 1 < h) c += tmp[(z + r + 1) * w + x];
      if (z - r >= 0) c -= tmp[(z - r) * w + x];
    }
  }
  return out;
}

/** 4-connected components of walkable cells (iterative flood fill). */
function label(free: Uint8Array, w: number, h: number): Int32Array {
  const comp = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let s = 0; s < free.length; s++) {
    if (!free[s] || comp[s]) continue;
    next++;
    let top = 0; stack[top++] = s; comp[s] = next;
    while (top) {
      const i = stack[--top], x = i % w;
      if (x > 0 && free[i - 1] && !comp[i - 1]) { comp[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && free[i + 1] && !comp[i + 1]) { comp[i + 1] = next; stack[top++] = i + 1; }
      if (i >= w && free[i - w] && !comp[i - w]) { comp[i - w] = next; stack[top++] = i - w; }
      if (i + w < free.length && free[i + w] && !comp[i + w]) { comp[i + w] = next; stack[top++] = i + w; }
    }
  }
  return comp;
}

/** Visit the cells whose centres are inside a polygon (scanline). */
export function fillPolygon(poly: Pt[], w: number, h: number, x0: number, z0: number, cell: number, visit: (i: number) => void) {
  if (poly.length < 3) return;
  let za = Infinity, zb = -Infinity;
  for (const [, z] of poly) { za = Math.min(za, z); zb = Math.max(zb, z); }
  const r0 = Math.max(0, Math.floor((za - z0) / cell)), r1 = Math.min(h - 1, Math.ceil((zb - z0) / cell));
  for (let row = r0; row <= r1; row++) {
    const zc = z0 + (row + 0.5) * cell;
    const xs: number[] = [];
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length];
      if ((az <= zc && bz > zc) || (bz <= zc && az > zc)) xs.push(ax + ((zc - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), c1 = Math.min(w - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let c = c0; c <= c1; c++) visit(row * w + c);
    }
  }
}

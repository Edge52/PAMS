/**
 * Solid walls with openings for the live 3D view (wave 16, 3D roadmap phase 3). Pure.
 *
 * - Walls: the drawing's wall and column lines rasterised and closed (both faces of a wall become one mass), cut into
 *   boxes — the render studio's method (render/walls.ts).
 * - Doors: where the drawing has a door, the gap between wall pieces is an opening: closing the mass with a wider
 *   window fills it, and the cells filled near a door line are the opening. It gets a lintel from door height up.
 * - Windows: glazing lines become a sill below the window, the glass, and a lintel above.
 * - Heights: a floor's walls stand from its slab to the next floor less the slab's thickness; a top floor or one
 *   with no floor above uses the floor below's height, else the default.
 */
import { close, combine, dilate, rasterise, rectangles, type Grid, type Rect } from "./render/walls";

export const DOOR_HEAD = 2.1, SILL = 0.9, SLAB = 0.35, DEFAULT_WALL = 3.3;
export type Bounds = { x0: number; x1: number; z0: number; z1: number };
export type Shell = { walls: Rect[]; lintels: Rect[]; windows: Rect[] };

/** Segments in metres from plan-unit segments, kept only inside the bounds (stray copies off the plan are dropped). */
export function toMetres(segs: number[] | null | undefined, s: number, b: Bounds, pad = 2): number[] {
  const out: number[] = [];
  if (!segs) return out;
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ax = segs[i] * s, az = segs[i + 1] * s, bx = segs[i + 2] * s, bz = segs[i + 3] * s;
    const ok = (x: number, z: number) => x >= b.x0 - pad && x <= b.x1 + pad && z >= b.z0 - pad && z <= b.z1 + pad;
    if (ok(ax, az) && ok(bx, bz)) out.push(ax, az, bx, bz);
  }
  return out;
}

/** The shell of one floor: wall boxes, door lintels and windows (rectangles in metres). */
export function shellOf(walls: number[], columns: number[], doors: number[], glass: number[], b: Bounds, cell = 0.1): Shell {
  if (walls.length < 4) return { walls: [], lintels: [], windows: [] };
  const raw = rasterise([...walls, ...columns], b, cell);
  const mass = close(raw, Math.max(1, Math.round(0.2 / cell)));
  // Door openings: a wide closing fills gaps up to ~1.8 m; keep only what it filled next to a door line.
  let lintel: Grid | null = null;
  if (doors.length >= 4) {
    const wide = close(raw, Math.max(2, Math.round(0.9 / cell)));
    const nearDoor = dilate(rasterise(doors, b, cell), Math.max(1, Math.round(0.35 / cell)));
    lintel = combine(combine(wide, mass, true), nearDoor);
  }
  // Windows: glazing closed into strips, minus what is already wall.
  let win: Grid | null = null;
  if (glass.length >= 4) win = combine(close(rasterise(glass, b, cell), Math.max(1, Math.round(0.15 / cell))), mass, true);
  return { walls: rectangles(mass), lintels: lintel ? rectangles(lintel) : [], windows: win ? rectangles(win) : [] };
}

/** Wall height of each floor (metres) from the floors' elevations. */
export function wallHeights(floors: { id: number; elevation: number; buildingName?: string }[]): Map<number, number> {
  const out = new Map<number, number>();
  const byBuilding = new Map<string, typeof floors>();
  for (const f of floors) { const k = f.buildingName ?? ""; (byBuilding.get(k) ?? byBuilding.set(k, []).get(k)!).push(f); }
  for (const list of byBuilding.values()) {
    const sorted = [...list].sort((a, b) => a.elevation - b.elevation);
    let last = DEFAULT_WALL;
    sorted.forEach((f, i) => {
      const above = sorted[i + 1];
      const h = above ? above.elevation - f.elevation - SLAB : last;
      const ok = Number.isFinite(h) && h >= 2.2 && h <= 12;
      out.set(f.id, ok ? Math.round(h * 100) / 100 : DEFAULT_WALL);
      if (ok) last = Math.round(h * 100) / 100;
    });
  }
  return out;
}

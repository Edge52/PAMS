/**
 * Bed and stretcher clearance on routes (wave 17, 3D roadmap phase 8). Along a route on a floor's walking network:
 * the clear width at each point (across the direction of travel, wall to wall), the pinch points too narrow for a bed
 * or for a bed to pass someone, and the corners a bed can't turn. Pure.
 *
 * Widths are measured on the network's grid (walls grown by one cell), so they are estimates to within about a cell
 * (0.25 m); a door narrower than the grid can see may be missed. Figures are typical planning values (HBN 00-04 style):
 * a bed is 2.3 m long with its pusher's reach and 1.05 m wide; it needs 1.2 m clear to pass, 1.8 m to pass a person.
 */
import type { Network } from "./network";

type Pt = [number, number];
export const BED = { length: 2.3, width: 1.05 };
export const CLEAR = { bed: 1.2, passing: 1.8 };

const freeAt = (n: Network, x: number, z: number) => {
  const i = Math.floor((x - n.x0) / n.cell), j = Math.floor((z - n.z0) / n.cell);
  return i >= 0 && j >= 0 && i < n.w && j < n.h && n.free[j * n.w + i] === 1;
};

/** Clear width (m) through (x, z) across the direction (dx, dz); null where the point isn't on the network. */
export function clearWidth(n: Network, x: number, z: number, dx: number, dz: number, maxM = 6): number | null {
  if (!freeAt(n, x, z)) return null;
  const len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len, step = n.cell / 2;
  const reach = (sx: number) => { let d = 0; while (d < maxM && freeAt(n, x + nx * sx * (d + step), z + nz * sx * (d + step))) d += step; return d; };
  // The network loses about 1.75 cells on each side of a corridor (the rasterised wall line plus the one-cell margin);
  // added back, measured widths come within a cell of the drawn ones on straight walls.
  return Math.min(maxM * 2, reach(1) + reach(-1) + n.cell * 3.5);
}

/**
 * The longest bed (or any W-wide rectangle) that turns a right-angle corner between corridors a and b wide: the
 * minimum over the bed's angle θ of a / sin θ + b / cos θ − W / (sin θ cos θ).
 */
export function longestThroughCorner(a: number, b: number, w: number): number {
  if (a <= w || b <= w) return 0;
  let best = Infinity;
  for (let k = 1; k < 90; k++) { const t = (k / 90) * (Math.PI / 2), s = Math.sin(t), c = Math.cos(t); best = Math.min(best, a / s + b / c - w / (s * c)); }
  return best;
}

export type Pinch = { x: number; z: number; width: number; length: number; need: "bed" | "passing" };
export type Turn = { x: number; z: number; a: number; b: number; fits: boolean };
export type LegClearance = { narrowest: { x: number; z: number; width: number } | null; pinches: Pinch[]; turns: Turn[] };

/**
 * One walk leg. Points closer than `skipM` to the ends are inside the start and end rooms and are left out. Narrow runs
 * below the bed width are reported wherever they are; below the passing width only when longer than 3 m (a corridor,
 * not a door).
 */
export function legClearance(n: Network, points: Pt[], opts: { skipM?: number; sampleM?: number } = {}): LegClearance {
  const skip = opts.skipM ?? 0.8, every = opts.sampleM ?? 0.4;
  const segLen = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = segLen.reduce((t, l) => t + l, 0);
  const samples: { x: number; z: number; w: number | null; at: number }[] = [];
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i], L = segLen[i - 1];
    if (L < 1e-6) continue;
    for (let d = 0; d < L; d += every) {
      const t = at + d; if (t < skip || t > total - skip) continue;
      const x = x0 + ((x1 - x0) * d) / L, z = z0 + ((z1 - z0) * d) / L;
      samples.push({ x, z, w: clearWidth(n, x, z, x1 - x0, z1 - z0), at: t });
    }
    at += L;
  }
  let narrowest: LegClearance["narrowest"] = null;
  for (const s of samples) if (s.w != null && (!narrowest || s.w < narrowest.width)) narrowest = { x: s.x, z: s.z, width: s.w };
  // Runs of samples below a threshold.
  const runs = (limit: number) => {
    const out: { from: number; to: number; min: { x: number; z: number; w: number } }[] = [];
    let cur: (typeof out)[number] | null = null;
    for (const s of samples) {
      if (s.w != null && s.w < limit) {
        if (!cur) cur = { from: s.at, to: s.at, min: { x: s.x, z: s.z, w: s.w } };
        cur.to = s.at; if (s.w < cur.min.w) cur.min = { x: s.x, z: s.z, w: s.w };
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  };
  const pinches: Pinch[] = runs(CLEAR.bed).map((r) => ({ x: r.min.x, z: r.min.z, width: r.min.w, length: r.to - r.from + every, need: "bed" as const }));
  for (const r of runs(CLEAR.passing)) {
    if (r.to - r.from + every < 3) continue;
    if (pinches.some((p) => Math.hypot(p.x - r.min.x, p.z - r.min.z) < 1)) continue;
    pinches.push({ x: r.min.x, z: r.min.z, width: r.min.w, length: r.to - r.from + every, need: "passing" });
  }
  // Corners: the corridor widths 1.5 m before and after each bend of more than 45°.
  const turns: Turn[] = [];
  for (let i = 1; i + 1 < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], [cx, cz] = points[i + 1];
    const u = [bx - ax, bz - az], v = [cx - bx, cz - bz], lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 0.5 || lv < 0.5) continue;
    const cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
    if (cos > Math.cos(Math.PI / 4)) continue;
    const back = Math.min(1.5, lu / 2), ahead = Math.min(1.5, lv / 2);
    const a = clearWidth(n, bx - (u[0] / lu) * back, bz - (u[1] / lu) * back, u[0], u[1]);
    const b = clearWidth(n, bx + (v[0] / lv) * ahead, bz + (v[1] / lv) * ahead, v[0], v[1]);
    if (a == null || b == null) continue;
    turns.push({ x: bx, z: bz, a, b, fits: longestThroughCorner(a, b, BED.width) >= BED.length });
  }
  return { narrowest, pinches, turns };
}

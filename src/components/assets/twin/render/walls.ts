/**
 * Presentation renders: solid walls from CAD linework. Pure.
 *
 * Drawings give both faces of a wall as separate lines. Rasterising the lines on a fine grid and closing the gap
 * between faces (dilate, then erode) turns them into solid wall mass; door openings, being far wider than a wall,
 * stay open. The mass is then cut into as few rectangles as possible (greedy meshing) so it can be drawn as boxes
 * with solid grey tops, like a cut-away architectural model.
 */

export type Grid = { w: number; h: number; cell: number; x0: number; z0: number; data: Uint8Array };
export type Rect = { x0: number; z0: number; x1: number; z1: number }; // metres

/** Rasterise segments [x1, z1, x2, z2, …] (metres) onto a grid covering `bounds` with a margin. */
export function rasterise(segs: number[], bounds: { x0: number; x1: number; z0: number; z1: number }, cell = 0.08): Grid {
  const x0 = bounds.x0 - 1, z0 = bounds.z0 - 1;
  const w = Math.ceil((bounds.x1 - bounds.x0 + 2) / cell), h = Math.ceil((bounds.z1 - bounds.z0 + 2) / cell);
  const data = new Uint8Array(w * h);
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ax = (segs[i] - x0) / cell, az = (segs[i + 1] - z0) / cell, bx = (segs[i + 2] - x0) / cell, bz = (segs[i + 3] - z0) / cell;
    const n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2) + 1;
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(ax + ((bx - ax) * k) / n), z = Math.floor(az + ((bz - az) * k) / n);
      if (x >= 0 && x < w && z >= 0 && z < h) data[z * w + x] = 1;
    }
  }
  return { w, h, cell, x0, z0, data };
}

/** 1-D sliding max (dilate) or min (erode) of radius r along rows or columns. */
function slide(src: Uint8Array, w: number, h: number, r: number, horizontal: boolean, max: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const len = horizontal ? w : h, lines = horizontal ? h : w;
  const at = (line: number, i: number) => (horizontal ? line * w + i : i * w + line);
  for (let line = 0; line < lines; line++) {
    // Count of set cells in the window; dilate: any set; erode: all set (cells beyond the edge count as set).
    let count = 0;
    for (let i = -r; i <= r; i++) count += i < 0 || i >= len ? (max ? 0 : 1) : src[at(line, i)];
    for (let i = 0; i < len; i++) {
      out[at(line, i)] = max ? (count > 0 ? 1 : 0) : (count === 2 * r + 1 ? 1 : 0);
      const add = i + r + 1, drop = i - r;
      count += add >= len ? (max ? 0 : 1) : src[at(line, add)];
      count -= drop < 0 ? (max ? 0 : 1) : src[at(line, drop)];
    }
  }
  return out;
}

/** Close gaps up to about 2r cells wide: dilate by r then erode by r (square window). */
export function close(g: Grid, r: number): Grid {
  let d = slide(g.data, g.w, g.h, r, true, true);
  d = slide(d, g.w, g.h, r, false, true);
  d = slide(d, g.w, g.h, r, true, false);
  d = slide(d, g.w, g.h, r, false, false);
  return { ...g, data: d };
}

/** Greedy meshing: cover the set cells with rectangles (runs per row, merged downwards when identical). */
export function rectangles(g: Grid): Rect[] {
  const out: Rect[] = [];
  let open = new Map<string, { a: number; b: number; z: number }>(); // runs continuing from the row above
  for (let z = 0; z <= g.h; z++) {
    const runs: [number, number][] = [];
    if (z < g.h) {
      let x = 0;
      while (x < g.w) {
        if (!g.data[z * g.w + x]) { x++; continue; }
        const a = x; while (x < g.w && g.data[z * g.w + x]) x++;
        runs.push([a, x]);
      }
    }
    const next = new Map<string, { a: number; b: number; z: number }>();
    for (const [a, b] of runs) {
      const key = `${a},${b}`;
      next.set(key, open.get(key) ?? { a, b, z });
    }
    for (const [key, r] of open) if (!next.has(key) || next.get(key) !== r) {
      out.push({ x0: g.x0 + r.a * g.cell, x1: g.x0 + r.b * g.cell, z0: g.z0 + r.z * g.cell, z1: g.z0 + z * g.cell });
    }
    open = next;
  }
  return out;
}

/** Wall mass rectangles from wall, column and glass-frame segments (metres). */
export function wallMass(segs: number[], bounds: { x0: number; x1: number; z0: number; z1: number }, cell = 0.08, closeM = 0.2): Rect[] {
  if (segs.length < 4) return [];
  return rectangles(close(rasterise(segs, bounds, cell), Math.max(1, Math.round(closeM / cell))));
}

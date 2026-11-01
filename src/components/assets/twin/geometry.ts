/** Pure geometry helpers for the 3D view (no three.js), so they can be unit-tested. */

export type Pt = [number, number];

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function centroid(poly: Pt[]): Pt {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f; a += f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** A point guaranteed inside the polygon (the centroid when it is inside, else the most central lattice point). */
export function interiorPoint(poly: Pt[]): Pt {
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const pts = latticeInside(poly, 12);
  if (!pts.length) return c;
  return pts.reduce((best, p) => (dist2(p, c) < dist2(best, c) ? p : best), pts[0]);
}

const dist2 = (a: Pt, b: Pt) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Lattice points inside the polygon, about `perSide` across its bounding box, kept away from the walls. */
export function latticeInside(poly: Pt[], perSide: number): Pt[] {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max((x1 - x0), (y1 - y0)) / (perSide + 1);
  const out: Pt[] = [];
  if (!(step > 0)) return out;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      if (pointInPolygon([x, y], poly) && pointInPolygon([x + step / 3, y], poly) && pointInPolygon([x - step / 3, y], poly)
        && pointInPolygon([x, y + step / 3], poly) && pointInPolygon([x, y - step / 3], poly)) out.push([x, y]);
    }
  }
  return out;
}

/**
 * Positions for `n` devices inside a room: evenly spread over a lattice inside its outline, centre-out,
 * so 1 device sits in the middle and a full ICU bay fans out. Returns plan coordinates.
 */
export function spreadInRoom(poly: Pt[], n: number): Pt[] {
  if (n <= 0) return [];
  const centre = interiorPoint(poly);
  if (n === 1) return [centre];
  let lattice: Pt[] = [];
  for (let k = Math.max(3, Math.ceil(Math.sqrt(n)) + 1); k <= 40 && lattice.length < n; k += 2) lattice = latticeInside(poly, k);
  if (lattice.length < n) {
    // Tiny or very thin room: stack the leftovers around the centre.
    return Array.from({ length: n }, (_, i) => lattice[i] ?? centre);
  }
  lattice.sort((a, b) => dist2(a, centre) - dist2(b, centre));
  // Take every k-th point of the centre-sorted lattice so devices spread across the room instead of clumping.
  const stride = Math.max(1, Math.floor(lattice.length / n));
  return Array.from({ length: n }, (_, i) => lattice[Math.min(lattice.length - 1, i * stride)]);
}

/** Rectangle (x, y, w, h) → polygon. */
export const rectPoly = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

/** Wall segments from room outlines (used for floors without CAD linework). Shared edges are emitted once. */
export function wallsFromRooms(polys: Pt[][]): number[] {
  const seen = new Set<string>(); const out: number[] = [];
  const key = (a: Pt, b: Pt) => {
    const r = (v: number) => Math.round(v * 2) / 2;
    const [p, q] = [a, b].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    return `${r(p[0])},${r(p[1])},${r(q[0])},${r(q[1])}`;
  };
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const k = key(a, b); if (seen.has(k)) continue;
      seen.add(k); out.push(a[0], a[1], b[0], b[1]);
    }
  }
  return out;
}

/** Department colours: distinct hues on a dark background. */
export const DEPARTMENT_PALETTE = [
  "#2fd3ff", "#7c6bff", "#ff6fb5", "#ffb547", "#4ff0a5", "#ff6b5b", "#5aa8ff", "#c56bff", "#f5e65b", "#43e0c9",
  "#ff8f3f", "#8fd14f", "#e85bd2", "#5b7bff", "#ffd27a", "#3ad9a0",
];

/** Marker shape per kind of equipment in the 3D view (close up); far away every device is a dot. */
export type DeviceKind = "bed" | "monitor" | "ventilator" | "imaging" | "pump" | "other";

const KIND_BY_PREFIX: [string, DeviceKind][] = [
  ["FUR-BED", "bed"], ["FUR-STR", "bed"], ["LIF-NEO", "bed"], ["OBG-DEL", "bed"], ["FUR-OPT", "bed"],
  ["LIF-VEN", "ventilator"], ["LIF-ANE", "ventilator"], ["LIF-RES", "ventilator"],
  ["INF", "pump"],
  ["IMG", "imaging"], ["RTH", "imaging"],
  ["MON", "monitor"], ["CAR", "monitor"], ["OBG-FET", "monitor"], ["LIF-DEF", "monitor"],
];

/** Kind from the device's group code (e.g. "LIF-VEN") and category code (e.g. "LIF"); the longest matching prefix wins. */
export function deviceKind(groupCode: string | null | undefined, categoryCode: string | null | undefined): DeviceKind {
  const codes = [groupCode, categoryCode].filter((c): c is string => !!c);
  let best: DeviceKind = "other", len = 0;
  for (const [p, k] of KIND_BY_PREFIX) {
    if (p.length > len && codes.some((c) => c === p || c.startsWith(p + "-"))) { best = k; len = p.length; }
  }
  return best;
}

export const KIND_LABELS: Record<DeviceKind, string> = {
  bed: "Beds and incubators", monitor: "Monitors and diagnostics", ventilator: "Ventilators and anaesthesia",
  imaging: "Imaging", pump: "Infusion pumps", other: "Other equipment",
};

/** Vertical cores read from room names: stairs, lifts and service shafts tie the floors together in the model. */
export type CoreKind = "stair" | "lift" | "shaft";
export function coreKind(name: string | null | undefined): CoreKind | null {
  const n = (name ?? "").toLowerCase();
  if (/\b(stair|staircase|escape)\b|\bstairs?\s*\d/.test(n)) return "stair";
  if (/\b(lift|elevator|elev\.?)\b/.test(n)) return "lift";
  if (/\bshaft\b|\briser\b|\bduct\b/.test(n)) return "shaft";
  return null;
}
export const CORE_LABELS: Record<CoreKind, string> = { stair: "Stairs", lift: "Lifts", shaft: "Service shafts" };

/**
 * Order to load floors in: the floor asked for first (or the one nearest ground level), then outwards from it, so
 * the model is usable after one floor and the rest stream in behind.
 */
export function floorLoadOrder<T extends { id: number; elevation: number }>(floors: T[], firstId: number | null = null): T[] {
  if (!floors.length) return [];
  const start = floors.find((f) => f.id === firstId)
    ?? [...floors].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation) || b.elevation - a.elevation)[0];
  return [...floors].sort((a, b) => Math.abs(a.elevation - start.elevation) - Math.abs(b.elevation - start.elevation) || b.elevation - a.elevation);
}

/** Frame-time budget: true when the average frame over the sample took longer than `ms` (a slow tablet or laptop). */
export function isSlow(frameMs: number[], ms = 45, min = 40): boolean {
  if (frameMs.length < min) return false;
  const sorted = [...frameMs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] > ms; // median: one stall (a tab switch, a GC) doesn't count
}

/**
 * The outline of a floor traced from its rooms (for the glass façade): rooms are rasterised onto a grid of `cell`
 * metres, small gaps (walls, shafts) are closed, and the edges between filled and empty cells are returned as segments
 * [x1, z1, x2, z2, …] in metres, with collinear runs merged. Polygons are in metres.
 */
export function outlineFromRooms(polys: Pt[][], cell = 1.5): number[] {
  const all = polys.filter((p) => p.length >= 3);
  if (!all.length) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) for (const [x, y] of p) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const pad = 2;
  const nx = Math.ceil((maxX - minX) / cell) + pad * 2, ny = Math.ceil((maxY - minY) / cell) + pad * 2;
  if (nx * ny > 400_000) return []; // a site plan, not a building: no façade
  const ox = minX - pad * cell, oy = minY - pad * cell;
  let grid = new Uint8Array(nx * ny);
  const boxes = all.map((p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of p) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d] as const; });
  for (let k = 0; k < all.length; k++) {
    const [a, b, c, d] = boxes[k];
    for (let j = Math.max(0, Math.floor((b - oy) / cell)); j <= Math.min(ny - 1, Math.floor((d - oy) / cell)); j++) {
      for (let i = Math.max(0, Math.floor((a - ox) / cell)); i <= Math.min(nx - 1, Math.floor((c - ox) / cell)); i++) {
        if (grid[j * nx + i]) continue;
        if (pointInPolygon([ox + (i + 0.5) * cell, oy + (j + 0.5) * cell], all[k])) grid[j * nx + i] = 1;
      }
    }
  }
  // Close gaps of one cell (walls between rooms): dilate, then erode.
  const morph = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(src.length);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let v = grow ? 0 : 1;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj;
        const s = x >= 0 && y >= 0 && x < nx && y < ny ? src[y * nx + x] : 0;
        if (grow ? s : !s) v = grow ? 1 : 0;
      }
      out[j * nx + i] = v;
    }
    return out;
  };
  grid = morph(morph(grid, true), false);
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < ny ? grid[j * nx + i] : 0);
  const segs: number[] = [];
  // Horizontal edges (between rows), merged along each row.
  for (let j = 0; j <= ny; j++) {
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const edge = i < nx && at(i, j) !== at(i, j - 1);
      if (edge && start < 0) start = i;
      if (!edge && start >= 0) { segs.push(ox + start * cell, oy + j * cell, ox + i * cell, oy + j * cell); start = -1; }
    }
  }
  for (let i = 0; i <= nx; i++) {
    let start = -1;
    for (let j = 0; j <= ny; j++) {
      const edge = j < ny && at(i, j) !== at(i - 1, j);
      if (edge && start < 0) start = j;
      if (!edge && start >= 0) { segs.push(ox + i * cell, oy + start * cell, ox + i * cell, oy + j * cell); start = -1; }
    }
  }
  return segs;
}

/** Camera placement for a preset view around a target (metres): returns the camera position. Pure. */
export function presetCamera(kind: "iso" | "plan" | "eye", target: { x: number; y: number; z: number }, size: number): { x: number; y: number; z: number } {
  if (kind === "plan") return { x: target.x, y: target.y + size * 1.25, z: target.z + 0.01 };
  if (kind === "eye") return { x: target.x - 6, y: target.y, z: target.z - 6 };
  const d = size * 1.1;
  return { x: target.x + d * 0.7, y: target.y + d * 0.75, z: target.z + d * 0.7 };
}

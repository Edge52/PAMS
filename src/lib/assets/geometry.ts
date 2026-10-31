/**
 * Floor-plan geometry: viewBox zoom/pan math, room hit-testing, pin auto-arrangement and the editor's
 * drag/resize maths. Pure — shared by the floor map, the mini map and the room layout editor.
 */

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type ViewBox = Rect;

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Smallest room containing the point (so a bay inside a ward wins over the ward). */
export function roomAt<T extends Rect>(rooms: T[], p: Point, skip?: (r: T) => boolean): T | null {
  let best: T | null = null;
  for (const r of rooms) {
    if (skip?.(r) || !containsPoint(r, p)) continue;
    if (!best || r.w * r.h < best.w * best.h) best = r;
  }
  return best;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function clampPointToRect(p: Point, r: Rect, margin = 0): Point {
  const m = Math.min(margin, r.w / 2, r.h / 2);
  return { x: clamp(p.x, r.x + m, r.x + r.w - m), y: clamp(p.y, r.y + m, r.y + r.h - m) };
}

export const ROOM_HEADER = 15; // plan units reserved at the top of a room for its label

export type Arrangement = { positions: Point[]; r: number; overflow: number };

/**
 * Lay out n pins in a neat grid inside a room, under the label strip.
 * Pins shrink for crowded rooms; below minCell the extra pins are reported as overflow (shown as "+N").
 */
export function autoArrange(room: Rect, n: number, opts: { maxCell?: number; minCell?: number; header?: number; pad?: number } = {}): Arrangement {
  const maxCell = opts.maxCell ?? 18, minCell = opts.minCell ?? 9, pad = opts.pad ?? 3;
  const header = Math.min(opts.header ?? ROOM_HEADER, room.h * 0.35);
  if (n <= 0) return { positions: [], r: maxCell * 0.4, overflow: 0 };
  const W = Math.max(1, room.w - pad * 2), H = Math.max(1, room.h - header - pad);
  // Best grid: try every column count, pick the one giving the largest cell.
  let best = { cols: 1, rows: n, cell: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cell = Math.min(W / cols, H / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  let { cols, rows, cell } = best;
  let shown = n;
  if (cell < minCell) {
    cell = minCell;
    cols = Math.max(1, Math.floor(W / cell));
    rows = Math.max(1, Math.floor(H / cell));
    shown = Math.max(1, cols * rows - 1); // keep one cell for the "+N" chip
    rows = Math.ceil((shown + 1) / cols);
  }
  cell = Math.min(cell, maxCell);
  const gridW = cols * cell, gridH = Math.min(rows, Math.ceil(shown / cols) + (shown < n ? 1 : 0)) * cell;
  const x0 = room.x + pad + (W - gridW) / 2, y0 = room.y + header + (H - gridH) / 2;
  const positions: Point[] = [];
  for (let i = 0; i < shown; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    positions.push({ x: x0 + c * cell + cell / 2, y: y0 + r * cell + cell / 2 });
  }
  if (shown < n) {
    const i = shown, c = i % cols, r = Math.floor(i / cols);
    positions.push({ x: x0 + c * cell + cell / 2, y: y0 + r * cell + cell / 2 }); // overflow chip position (last)
  }
  return { positions, r: cell * 0.4, overflow: n - shown };
}

/* ── viewBox math ── */

export type ZoomLimits = { minW: number; maxW: number };

/** Zoom by `factor` (>1 zooms in) keeping point p (plan units) under the cursor. */
export function zoomAt(vb: ViewBox, factor: number, p: Point, limits: ZoomLimits): ViewBox {
  const w = clamp(vb.w / factor, limits.minW, limits.maxW);
  const f = vb.w / w;
  const h = vb.h / f;
  return { x: p.x - (p.x - vb.x) / f, y: p.y - (p.y - vb.y) / f, w, h };
}

export function panBy(vb: ViewBox, dx: number, dy: number): ViewBox {
  return { ...vb, x: vb.x - dx, y: vb.y - dy };
}

/** Keep at least `keep` (fraction) of the plan visible so it can't be flung off-screen. */
export function clampViewBox(vb: ViewBox, plan: { w: number; h: number }, keep = 0.2): ViewBox {
  const minX = -vb.w + plan.w * keep, maxX = plan.w * (1 - keep);
  const minY = -vb.h + plan.h * keep, maxY = plan.h * (1 - keep);
  return { ...vb, x: clamp(vb.x, Math.min(minX, maxX), Math.max(minX, maxX)), y: clamp(vb.y, Math.min(minY, maxY), Math.max(minY, maxY)) };
}

/** A viewBox around `target` with padding, stretched to the container's aspect ratio (w/h). */
export function fitRect(target: Rect, aspect: number, pad = 0.08): ViewBox {
  const px = target.w * pad + 10, py = target.h * pad + 10;
  let w = target.w + px * 2, h = target.h + py * 2;
  if (aspect > 0) {
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
  }
  return { x: target.x + target.w / 2 - w / 2, y: target.y + target.h / 2 - h / 2, w, h };
}

/** Pixels per plan unit for an SVG using preserveAspectRatio="xMidYMid meet". */
export function screenScale(vb: ViewBox, client: { width: number; height: number }): number {
  return Math.min(client.width / vb.w, client.height / vb.h) || 1;
}

/* ── editor ── */

export function snap(v: number, grid = 5): number {
  return Math.round(v / grid) * grid;
}

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Apply a drag delta to a rectangle for a handle, keeping a minimum size and the plan bounds. */
export function dragRect(start: Rect, handle: Handle, dx: number, dy: number, bounds: { w: number; h: number }, opts: { min?: number; grid?: number } = {}): Rect {
  const min = opts.min ?? 20, g = opts.grid ?? 5;
  let { x, y, w, h } = start;
  if (handle === "move") {
    x = clamp(snap(start.x + dx, g), 0, Math.max(0, bounds.w - w));
    y = clamp(snap(start.y + dy, g), 0, Math.max(0, bounds.h - h));
    return { x, y, w, h };
  }
  const right = start.x + start.w, bottom = start.y + start.h;
  if (handle.includes("e")) w = clamp(snap(right + dx, g), start.x + min, bounds.w) - start.x;
  if (handle.includes("s")) h = clamp(snap(bottom + dy, g), start.y + min, bounds.h) - start.y;
  if (handle.includes("w")) { x = clamp(snap(start.x + dx, g), 0, right - min); w = right - x; }
  if (handle.includes("n")) { y = clamp(snap(start.y + dy, g), 0, bottom - min); h = bottom - y; }
  return { x, y, w, h };
}

/** Next free spot for a new room: centre of the current view, nudged to avoid exact overlap. */
export function placeNewRoom(view: Rect, existing: Rect[], size = { w: 100, h: 80 }, bounds?: { w: number; h: number }): Rect {
  let x = snap(view.x + view.w / 2 - size.w / 2), y = snap(view.y + view.h / 2 - size.h / 2);
  for (let i = 0; i < 20 && existing.some((r) => r.x === x && r.y === y); i++) { x += 10; y += 10; }
  if (bounds) { x = clamp(x, 0, Math.max(0, bounds.w - size.w)); y = clamp(y, 0, Math.max(0, bounds.h - size.h)); }
  return { x, y, ...size };
}

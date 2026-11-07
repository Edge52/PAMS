/**
 * Drawing symbols (wave 16, phase 2): store a floor's symbols from the building file, each in the room it falls in.
 * Takes `db` (or a transaction) so seeds and the drawing update can both call it. `roomAt` is pure.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../../db";
import { drawingSymbols, rooms } from "../../db/schema";

export type CadSymbol = { kind: string; code: string | null; label: string; block?: string | null; x: number; y: number; rot?: number };
type Pt = [number, number];

function inside([x, y]: Pt, p: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** The room a point falls in: the smallest outline holding it (a room inside an open area wins), or null. */
export function roomAt(rs: { id: number; poly: Pt[] }[], x: number, y: number): number | null {
  let best: { id: number; a: number } | null = null;
  for (const r of rs) {
    if (r.poly.length < 3 || !inside([x, y], r.poly)) continue;
    let a = 0; for (let i = 0; i < r.poly.length; i++) { const [x1, y1] = r.poly[i], [x2, y2] = r.poly[(i + 1) % r.poly.length]; a += x1 * y2 - x2 * y1; }
    a = Math.abs(a);
    if (!best || a < best.a) best = { id: r.id, a };
  }
  return best?.id ?? null;
}

/** Replace a floor's symbols. */
export async function writeFloorSymbols(d: Pick<DB, "select" | "insert" | "delete">, floorId: number, symbols: CadSymbol[] | undefined): Promise<number> {
  await d.delete(drawingSymbols).where(eq(drawingSymbols.floorId, floorId));
  if (!symbols?.length) return 0;
  const rs = (await d.select({ id: rooms.id, polygon: rooms.polygon, x: rooms.x, y: rooms.y, w: rooms.w, h: rooms.h }).from(rooms).where(eq(rooms.floorId, floorId)))
    .map((r) => ({ id: r.id, poly: (r.polygon && r.polygon.length >= 3 ? r.polygon : [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]) as Pt[] }));
  const rows = symbols.map((s) => ({ floorId, roomId: roomAt(rs, s.x, s.y), kind: String(s.kind).slice(0, 16), code: s.code ? String(s.code).slice(0, 32) : null,
    label: String(s.label ?? s.block ?? "Symbol").slice(0, 120), block: s.block ? String(s.block).slice(0, 200) : null, x: s.x, y: s.y, rot: s.rot ?? 0 }));
  for (let i = 0; i < rows.length; i += 500) await d.insert(drawingSymbols).values(rows.slice(i, i + 500));
  return rows.length;
}

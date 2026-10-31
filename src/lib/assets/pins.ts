/**
 * Where each asset pin sits on a floor plan. Shared by the interactive floor map and the static mini map so a pin is
 * in the same place on both. Pure.
 *
 * - Assets with posX/posY inside their room keep that spot.
 * - The rest are auto-arranged in a grid inside the room (sorted by `sortKey`, e.g. device type then tag).
 * - Very crowded rooms show as many pins as fit plus a "+N" overflow chip.
 */
import { autoArrange, clampPointToRect, containsPoint, type Rect } from "./geometry";
import { pointInPolygon, spreadInRoom, type Pt } from "../../components/assets/twin/geometry";

export type PinAsset = { id: number; roomId: number | null; posX: number | null; posY: number | null; sortKey: string };
/** Rooms with a CAD outline (`polygon`) place pins inside that outline instead of the bounding rectangle. */
export type PinRoom = Rect & { id: number; polygon?: Pt[] | null };
export type PinPos = { x: number; y: number; r: number; auto: boolean };
export type Overflow = { roomId: number; x: number; y: number; r: number; count: number; assetIds: number[] };

export const PIN_R_MIN = 3.2;
export const PIN_R_MAX = 9;

export function layoutPins(rooms: PinRoom[], assets: PinAsset[]): { pos: Map<number, PinPos>; overflow: Overflow[] } {
  const byRoom = new Map<number, PinAsset[]>();
  for (const a of assets) {
    if (a.roomId == null) continue;
    const list = byRoom.get(a.roomId) ?? [];
    list.push(a);
    byRoom.set(a.roomId, list);
  }
  const pos = new Map<number, PinPos>();
  const overflow: Overflow[] = [];
  for (const room of rooms) {
    const list = byRoom.get(room.id);
    if (!list?.length) continue;
    const r = Math.min(PIN_R_MAX, Math.max(PIN_R_MIN, autoArrange(room, list.length, { maxCell: 23 }).r));
    const fixed: PinAsset[] = [], auto: PinAsset[] = [];
    for (const a of list) {
      const inside = a.posX != null && a.posY != null && (room.polygon?.length ? pointInPolygon([a.posX, a.posY], room.polygon) : containsPoint(room, { x: a.posX, y: a.posY }));
      if (inside) fixed.push(a);
      else auto.push(a);
    }
    for (const a of fixed) {
      const p = clampPointToRect({ x: a.posX as number, y: a.posY as number }, room, r);
      pos.set(a.id, { ...p, r, auto: false });
    }
    auto.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.id - b.id);
    if (room.polygon && room.polygon.length >= 3) {
      const spots = spreadInRoom(room.polygon, auto.length);
      const pr = Math.min(r, PIN_R_MAX * 0.8);
      auto.forEach((a, i) => pos.set(a.id, { x: spots[i][0], y: spots[i][1], r: pr, auto: true }));
      continue;
    }
    const arr = autoArrange(room, auto.length, { maxCell: 23 });
    const ar = Math.min(r, Math.max(PIN_R_MIN, arr.r));
    const shown = auto.length - arr.overflow;
    for (let i = 0; i < shown; i++) pos.set(auto[i].id, { ...arr.positions[i], r: ar, auto: true });
    if (arr.overflow > 0) {
      const p = arr.positions[arr.positions.length - 1];
      overflow.push({ roomId: room.id, x: p.x, y: p.y, r: ar, count: arr.overflow, assetIds: auto.slice(shown).map((a) => a.id) });
    }
  }
  return { pos, overflow };
}

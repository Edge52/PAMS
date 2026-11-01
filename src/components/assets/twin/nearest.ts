/**
 * "Nearest available": rank devices by walking distance from a room. Same floor: straight line. Another floor: to the
 * nearest lift (or stairs when there is no lift), up or down, then from that core to the device. Pure, metres.
 */

export type Spot = { floorId: number; elevation: number; x: number; z: number };
export type Core = Spot & { kind: "lift" | "stair" };
export type Ranked = { id: number; distance: number; sameFloor: boolean; via: Core | null; floors: number };

/** Metres of walking that one storey of lift travel is counted as (waiting and riding). */
export const STOREY_COST_M = 25;
/** Stairs cost more per storey than a lift. */
export const STAIR_STOREY_COST_M = 40;

const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export function rankNearest(from: Spot, candidates: (Spot & { id: number })[], cores: Core[], storeyHeight = 5): Ranked[] {
  const out: Ranked[] = [];
  for (const c of candidates) {
    if (c.floorId === from.floorId) { out.push({ id: c.id, distance: flat(from, c), sameFloor: true, via: null, floors: 0 }); continue; }
    const storeys = Math.max(1, Math.round(Math.abs(c.elevation - from.elevation) / storeyHeight));
    // Cores on the start floor; lifts preferred, stairs only when a floor has no lift.
    const here = cores.filter((k) => k.floorId === from.floorId);
    let best: { d: number; via: Core | null } = { d: Infinity, via: null };
    for (const k of here) {
      const per = k.kind === "lift" ? STOREY_COST_M : STAIR_STOREY_COST_M;
      const d = flat(from, k) + storeys * per + flat(k, c);
      if (d < best.d) best = { d, via: k };
    }
    // No core drawn on this floor: count the straight line plus the storeys.
    if (!best.via) best = { d: flat(from, c) + storeys * STAIR_STOREY_COST_M, via: null };
    out.push({ id: c.id, distance: best.d, sameFloor: false, via: best.via, floors: storeys });
  }
  return out.sort((a, b) => Number(b.sameFloor) - Number(a.sameFloor) || a.distance - b.distance);
}

/** Statuses that count as "available to use". */
export const AVAILABLE = new Set(["IN_SERVICE", "INSTALLED"]);

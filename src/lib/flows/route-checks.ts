/**
 * Pathway checks that need the building (wave 8, A1): each arrow is routed the way its patients travel, and the
 * steps' rooms are checked against the drawings and the catalogue. Runs on the server (route-server.ts) and is pure
 * apart from the route service it's given, so it can be tested with a small fake building.
 *
 * Errors block publishing: a bed or trolley leg between floors with no bed lift, and a step whose room a drawing update
 * removed. Everything else is a warning.
 */
import type { Issue, Link, Step } from "./model";
import type { Journey } from "../assets/lifts";
import type { Network } from "../../components/assets/twin/nav/network";
import type { Place, Route } from "../../components/assets/twin/nav/route";
import { CLEAR, legClearance } from "../../components/assets/twin/nav/clearance";

export type CheckRoom = { id: number; floorId: number; name: string; departmentId: number | null; type: string; zone?: string | null; poly: [number, number][] };
export type CheckStep = Step & { roomCode?: string | null; roomLabel?: string | null };
export type RouteSource = {
  roomPlace(roomId: number): Promise<Place | null>;
  route(a: Place, b: Place, journey: Journey, hour?: number | null): Promise<Route | null>;
  network(floorId: number): Promise<Network | null>;
};
export type BuildingIssue = Issue & { floorId?: number };

const journeyOf = (t: Link["transport"]): Journey => (t === "BED" || t === "TROLLEY" ? "bed" : t === "WHEELCHAIR" ? "wheelchair" : "foot");
const area = (p: [number, number][]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const inside = ([x, y]: [number, number], poly: [number, number][]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** The room a step is drawn at: its own, else its department's largest care room (as in the 3D view). */
export function placeRoom(s: Step, rooms: CheckRoom[]): CheckRoom | null {
  if (s.roomId != null) return rooms.find((r) => r.id === s.roomId) ?? null;
  if (s.departmentId == null) return null;
  return rooms.filter((r) => r.departmentId === s.departmentId && r.type !== "CORRIDOR" && r.poly.length >= 3).sort((a, b) => area(b.poly) - area(a.poly))[0] ?? null;
}

export async function buildingChecks(steps: CheckStep[], links: Link[], rooms: CheckRoom[], src: RouteSource, opts: {
  /** Device type codes in the catalogue. */
  catalogue?: Set<string>;
  /** Plan units per metre of each floor (to find the rooms a route passes through). */
  unitsPerMetre?: (floorId: number) => number;
  /** Hour the lifts are waited for (the pathway's busiest). */
  hour?: number | null;
} = {}): Promise<BuildingIssue[]> {
  const out: BuildingIssue[] = [];
  const label = (k: string) => steps.find((s) => s.key === k)?.label ?? k;

  for (const s of steps) {
    if (s.roomId == null && s.roomCode) out.push({ level: "error", stepKey: s.key, message: `${s.label}: its room ${s.roomLabel ?? ""} (${s.roomCode}) is no longer in the drawings. Choose its new room.` });
    const r = placeRoom(s, rooms);
    if (r && s.kind === "STEP") {
      const net = await src.network(r.floorId);
      const e = net?.rooms.get(r.id);
      if (net && (!e || !e.reached)) out.push({ level: "warning", stepKey: s.key, floorId: r.floorId, message: `${s.label}: ${r.name} isn't on the walking network, so routes to it are estimated. Add an opening on its floor.` });
    }
    if (opts.catalogue) for (const c of s.equipment) {
      if (!opts.catalogue.has(c) && ![...opts.catalogue].some((x) => x.startsWith(`${c}-`))) out.push({ level: "warning", stepKey: s.key, message: `${s.label}: equipment code ${c} isn't in the catalogue.` });
    }
  }

  for (const l of links) {
    const a = steps.find((s) => s.key === l.fromKey), b = steps.find((s) => s.key === l.toKey);
    if (!a || !b) continue;
    const ra = placeRoom(a, rooms), rb = placeRoom(b, rooms);
    if (!ra || !rb) continue;
    const [pa, pb] = await Promise.all([src.roomPlace(ra.id), src.roomPlace(rb.id)]);
    if (!pa || !pb) continue;
    const j = journeyOf(l.transport);
    const rt = await src.route(pa, pb, j, opts.hour);
    const what = `${label(l.fromKey)} → ${label(l.toKey)}`;
    if (!rt) {
      if (ra.floorId !== rb.floorId && j === "bed") out.push({ level: "error", stepKey: l.fromKey, message: `${what}: no bed lift serves both floors. Declare one under Facilities › Lifts, or change the transport.` });
      else out.push({ level: "warning", stepKey: l.fromKey, message: `${what}: no route found (${j === "wheelchair" ? "no lift for wheelchairs between these floors" : "the rooms aren't connected"}).` });
      continue;
    }
    if (rt.estimated) out.push({ level: "warning", stepKey: l.fromKey, floorId: rt.legs.find((x) => x.estimated)?.floorId, message: `${what}: part of the route isn't on the walking network and is estimated.` });
    // Beds and trolleys (wave 17): pinch points and corners a bed can't turn, on the legs walked on the network.
    if (j === "bed") {
      const pinch: string[] = [], corners: string[] = [];
      let fl: number | undefined;
      for (const leg of rt.legs) {
        if (leg.kind !== "walk" || leg.estimated) continue;
        const net = await src.network(leg.floorId); if (!net) continue;
        const c = legClearance(net, leg.points as [number, number][]);
        for (const p of c.pinches) { pinch.push(`${p.width.toFixed(1)} m${p.need === "passing" ? ` for ${Math.round(p.length)} m` : ""}`); fl ??= leg.floorId; }
        for (const t of c.turns) if (!t.fits) { corners.push(`${t.a.toFixed(1)} × ${t.b.toFixed(1)} m`); fl ??= leg.floorId; }
      }
      if (pinch.length) out.push({ level: "warning", stepKey: l.fromKey, floorId: fl, message: `${what}: the bed route narrows to ${pinch.slice(0, 3).join(", ")} (a bed needs ${CLEAR.bed} m, ${CLEAR.passing} m to pass someone).` });
      if (corners.length) out.push({ level: "warning", stepKey: l.fromKey, floorId: fl, message: `${what}: a bed can't turn ${corners.length === 1 ? "a corner" : `${corners.length} corners`} (corridors ${corners.slice(0, 2).join("; ")}).` });
    }
    // Staff-only rooms crossed by a patient on foot or in a wheelchair (other than the leg's own rooms).
    if (j !== "bed") {
      const crossed = new Set<string>();
      for (const leg of rt.legs) {
        if (leg.kind !== "walk") continue;
        const k = opts.unitsPerMetre?.(leg.floorId) ?? 10;
        for (let i = 1; i < leg.points.length; i++) {
          const [x0, z0] = leg.points[i - 1], [x1, z1] = leg.points[i];
          const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
          for (let t = 0; t <= n; t++) {
            const p: [number, number] = [(x0 + ((x1 - x0) * t) / n) * k, (z0 + ((z1 - z0) * t) / n) * k];
            for (const r of rooms) if (r.floorId === leg.floorId && r.zone === "STAFF" && r.id !== ra.id && r.id !== rb.id && inside(p, r.poly)) crossed.add(r.name);
          }
        }
      }
      if (crossed.size) out.push({ level: "warning", stepKey: l.fromKey, message: `${what}: patients pass through staff-only ${[...crossed].slice(0, 3).join(", ")}${crossed.size > 3 ? "…" : ""}.` });
    }
  }
  return out;
}

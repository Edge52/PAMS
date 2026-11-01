/**
 * Lift cores (wave 7): kinds, who may use them, and suggestions read from a building's drawings. Pure.
 *
 * Drawings rarely name lifts on every floor (La Plaza names them only on the garden floor; the other floors show lift
 * lobbies), so lifts are declared once per building. `suggestLifts` proposes them from lift lobbies:
 *
 * 1. Rooms named as a lift, elevator or AGV lobby, or a "public lobby", start or join a core when they sit within
 *    `radiusM` of it on a floor the core doesn't stop on yet.
 * 2. A core then extends floor by floor, up and down, to plain lobbies and halls within the radius, and stops at the
 *    first floor without one.
 * 3. Floors skipped between its lowest and highest stop are filled at the core's position: a lift serves the floors
 *    it passes, in all the buildings we've seen.
 * 4. Kind from the names: AGV lobby → AGV lifts plus an assumed bed lift beside them (the back-of-house lobby), parking
 *    → public, emergency department → bed, otherwise public.
 *
 * Every suggestion is marked `inferred`; a person confirms or corrects it under Facilities › Lifts.
 */
import { interiorPoint, type Pt } from "../../components/assets/twin/geometry";

export const LIFT_KINDS = ["BED", "PUBLIC", "SERVICE", "AGV"] as const;
export type LiftKind = (typeof LIFT_KINDS)[number];
export type LiftStop = { floorId: number; x: number; y: number };

export const LIFT_KIND_LABELS: Record<LiftKind, string> = {
  BED: "Bed lift", PUBLIC: "Public lift", SERVICE: "Service lift", AGV: "AGV (automated trolleys)",
};
export const LIFT_KIND_HINTS: Record<LiftKind, string> = {
  BED: "Beds and trolleys, staff, patients on foot or in wheelchairs",
  PUBLIC: "Patients on foot or in wheelchairs, visitors, staff",
  SERVICE: "Supplies and waste flows only",
  AGV: "Automated trolleys only; never a patient route",
};

/** How someone (or something) moves along a route; decides which lifts they may take. */
export type Journey = "foot" | "wheelchair" | "bed" | "supplies" | "agv";
const ALLOWED: Record<Journey, LiftKind[]> = {
  foot: ["PUBLIC", "BED"],
  wheelchair: ["PUBLIC", "BED"],
  bed: ["BED"],
  supplies: ["SERVICE"],
  agv: ["AGV"],
};
export const liftAllowed = (kind: LiftKind, journey: Journey) => ALLOWED[journey].includes(kind);

export type LiftFloor = { id: number; level: number; unitsPerMetre: number; name?: string };
export type LiftRoom = { floorId: number; name: string; code?: string | null; dept?: string | null; poly: Pt[] };
export type LiftSuggestion = { name: string; kind: LiftKind; stops: LiftStop[]; inferred: true; note: string };

const PRIMARY = /\b(lift|elevator|elev\.?)\b|\bagv\b|\bpublic lobby\b/i;
const SECONDARY = /\blobby\b|\bhall\b/i;

type Hit = { floorId: number; level: number; x: number; y: number; name: string; dept: string };
type Cluster = { hits: Hit[]; filled: Set<number> };

const centre = (c: Cluster): Pt => {
  const n = c.hits.length;
  return [c.hits.reduce((s, h) => s + h.x, 0) / n, c.hits.reduce((s, h) => s + h.y, 0) / n];
};

export function suggestLifts(floors: LiftFloor[], rooms: LiftRoom[], radiusM = 8): LiftSuggestion[] {
  const byId = new Map(floors.map((f) => [f.id, f]));
  const levels = [...floors].sort((a, b) => a.level - b.level);
  const toHit = (r: LiftRoom): Hit | null => {
    const f = byId.get(r.floorId); if (!f || r.poly.length < 3) return null;
    const [x, y] = interiorPoint(r.poly);
    return { floorId: f.id, level: f.level, x, y, name: r.name, dept: (r.dept ?? r.code ?? "").toUpperCase() };
  };
  const within = (h: Hit, c: Cluster) => {
    const [cx, cy] = centre(c);
    const upm = byId.get(h.floorId)?.unitsPerMetre || 10;
    return Math.hypot(h.x - cx, h.y - cy) <= radiusM * upm;
  };
  const stopsOn = (c: Cluster, floorId: number) => c.hits.some((h) => h.floorId === floorId);

  // 1. Lift lobbies start or join cores.
  const primary = rooms.filter((r) => PRIMARY.test(r.name)).map(toHit).filter((h): h is Hit => !!h)
    .sort((a, b) => a.level - b.level || a.x - b.x);
  const clusters: Cluster[] = [];
  for (const h of primary) {
    const near = clusters.filter((c) => !stopsOn(c, h.floorId) && within(h, c))
      .sort((a, b) => dist(h, centre(a)) - dist(h, centre(b)))[0];
    if (near) near.hits.push(h); else clusters.push({ hits: [h], filled: new Set() });
  }

  // 2. Extend to plain lobbies floor by floor.
  const secondary = rooms.filter((r) => !PRIMARY.test(r.name) && SECONDARY.test(r.name)).map(toHit).filter((h): h is Hit => !!h);
  for (const c of clusters) {
    for (const dir of [1, -1]) {
      const served = c.hits.map((h) => levels.findIndex((f) => f.id === h.floorId));
      let i = dir > 0 ? Math.max(...served) + 1 : Math.min(...served) - 1;
      while (i >= 0 && i < levels.length) {
        const f = levels[i];
        const pick = secondary.filter((h) => h.floorId === f.id && within(h, c)).sort((a, b) => dist(a, centre(c)) - dist(b, centre(c)))[0];
        if (!pick) break;
        c.hits.push(pick);
        i += dir;
      }
    }
  }

  // 3 and 4. Fill skipped floors, name and type each core.
  const out: LiftSuggestion[] = [];
  for (const c of clusters) {
    const idx = c.hits.map((h) => levels.findIndex((f) => f.id === h.floorId));
    const lo = Math.min(...idx), hi = Math.max(...idx);
    if (hi === lo) continue; // a lift with one stop goes nowhere: leave it to a person
    const [cx, cy] = centre(c);
    const stops: LiftStop[] = [];
    for (let i = lo; i <= hi; i++) {
      const f = levels[i];
      const h = c.hits.find((x) => x.floorId === f.id);
      if (h) stops.push({ floorId: f.id, x: round(h.x), y: round(h.y) });
      else { stops.push({ floorId: f.id, x: round(cx), y: round(cy) }); c.filled.add(f.id); }
    }
    const names = c.hits.map((h) => h.name.toLowerCase()).join(" | ");
    const depts = c.hits.map((h) => h.dept).join(" ");
    const range = `${levelName(levels[lo])}–${levelName(levels[hi])}`;
    const filledNote = c.filled.size ? ` Stops assumed on ${[...c.filled].map((id) => levelName(byId.get(id)!)).join(", ")} (no lobby drawn there).` : "";
    const from = `Read from ${[...new Set(c.hits.map((h) => h.name))].slice(0, 3).join(", ")}.`;
    if (/\bagv\b/.test(names)) {
      out.push({ name: `AGV lifts (${range})`, kind: "AGV", stops, inferred: true, note: `${from}${filledNote}` });
      out.push({
        name: `Back-of-house bed lift (${range}, assumed)`, kind: "BED", stops: stops.map((s) => ({ ...s })), inferred: true,
        note: `Assumed: back-of-house lift lobbies usually also serve bed and service lifts. Without it, beds couldn't change floors. Check the drawings and correct. ${from}${filledNote}`,
      });
    } else if (/parking/.test(names)) {
      out.push({ name: `Parking lifts (${range})`, kind: "PUBLIC", stops, inferred: true, note: `${from}${filledNote}` });
    } else if (/\b(ER|EMERGENCY|A&E)\b|-ER-/.test(depts) || /\b(bed|stretcher|patient)\b/.test(names)) {
      out.push({ name: `Emergency bed lift (${range})`, kind: "BED", stops, inferred: true, note: `From a lift lobby in the emergency department. ${from}${filledNote}` });
    } else {
      out.push({ name: `Public lifts (${range})`, kind: "PUBLIC", stops, inferred: true, note: `${from}${filledNote}` });
    }
  }
  return out;
}

const dist = (h: { x: number; y: number }, [x, y]: Pt) => Math.hypot(h.x - x, h.y - y);
const round = (v: number) => Math.round(v * 10) / 10;
const levelName = (f: LiftFloor) => f.name ?? (f.level < 0 ? `B${-f.level}` : `level ${f.level}`);

/** Stops on floors that still exist, in level order. */
export function liveStops(stops: LiftStop[], floors: LiftFloor[]): LiftStop[] {
  const order = new Map(floors.map((f) => [f.id, f.level]));
  return stops.filter((s) => order.has(s.floorId)).sort((a, b) => order.get(a.floorId)! - order.get(b.floorId)!);
}

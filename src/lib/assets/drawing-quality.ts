/**
 * Drawing quality (wave 16, 3D roadmap phase 1). Pure: checks one hospital's floors as imported — layers found, how
 * each room outline was made, overlapping rooms, scale and units, alignment between floors, how old each floor's
 * drawing is, rooms no door leads to — and gives each floor a score out of 100 and each room a confidence:
 * verified (checked on site), from the drawing (closed by walls), or assumed (split, fallback box or drawn by hand).
 */

export type Pt = [number, number];
export type Confidence = "verified" | "drawing" | "assumed";
export type Severity = "high" | "medium" | "low";

export type QRoom = { id: number; code: string; name: string; type: string; poly: Pt[]; outlineSource: string | null; verified: boolean };
export type QFloor = {
  id: number; name: string; level: number;
  /** Plan units per metre (null = no scale: drawn by hand on an arbitrary grid). */
  unitsPerMetre: number | null;
  cad: null | {
    sourceFile: string | null; revision: string | null; importedAt: string;
    segments: { walls: number; doors: number; glass: number; columns: number };
    alignment: { lifts: number; residualMm: number } | null;
    /** The reference floor others are aligned to (no alignment of its own). */
    reference?: boolean;
  };
  rooms: QRoom[];
  /** Rooms the walking network can't reach (from the routes service), when worked out. */
  unreachable?: number[] | null;
};
export type Issue = { key: string; severity: Severity; title: string; detail: string; roomIds?: number[] };
export type FloorReport = {
  floorId: number; name: string; level: number; score: number; grade: "good" | "fair" | "poor";
  rooms: number; byConfidence: Record<Confidence, number>; byOutline: Record<string, number>; issues: Issue[];
};

export const OUTLINE_LABELS: Record<string, string> = {
  walls: "Closed by walls in the drawing", split: "Open area split between room labels", fallback: "No outline found: a box around the label",
  drawn: "Drawn in the app", unknown: "Not recorded",
};
export const CONFIDENCE_LABELS: Record<Confidence, string> = { verified: "Verified on site", drawing: "From the drawing", assumed: "Assumed" };

/** A room's confidence: checked on site beats the drawing; split, fallback, hand-drawn or unrecorded outlines are assumed. */
export function roomConfidence(r: { outlineSource: string | null; verified: boolean }): Confidence {
  if (r.verified) return "verified";
  return r.outlineSource === "walls" ? "drawing" : "assumed";
}

export function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
}
function inside([x, y]: Pt, p: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const bbox = (p: Pt[]) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return { x0, x1, y0, y1 }; };

/** Pairs of rooms that overlap by more than `share` of the smaller one (sampled on a 12 × 12 grid). */
export function overlaps(rooms: { id: number; poly: Pt[] }[], share = 0.3): [number, number][] {
  const rs = rooms.filter((r) => r.poly.length >= 3).map((r) => ({ ...r, b: bbox(r.poly), a: polyArea(r.poly) }));
  const out: [number, number][] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.b.x1 <= b.b.x0 || b.b.x1 <= a.b.x0 || a.b.y1 <= b.b.y0 || b.b.y1 <= a.b.y0) continue;
    const [small, big] = a.a <= b.a ? [a, b] : [b, a];
    let n = 0, hit = 0;
    for (let u = 0; u < 12; u++) for (let v = 0; v < 12; v++) {
      const pt: Pt = [small.b.x0 + ((u + 0.5) / 12) * (small.b.x1 - small.b.x0), small.b.y0 + ((v + 0.5) / 12) * (small.b.y1 - small.b.y0)];
      if (!inside(pt, small.poly)) continue;
      n++; if (inside(pt, big.poly)) hit++;
    }
    if (n && hit / n > share) out.push([a.id, b.id]);
  }
  return out;
}

const DAY = 86400_000;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The report for every floor of a hospital. */
export function drawingQuality(floors: QFloor[]): FloorReport[] {
  // The scale most CAD floors share, and the newest drawing, to spot a floor that differs.
  const scales = floors.filter((f) => f.cad && f.unitsPerMetre).map((f) => f.unitsPerMetre!);
  const usual = scales.sort((a, b) => scales.filter((x) => x === b).length - scales.filter((x) => x === a).length)[0] ?? null;
  const newest = Math.max(0, ...floors.filter((f) => f.cad).map((f) => Date.parse(f.cad!.importedAt)));

  return floors.map((f) => {
    const issues: Issue[] = [];
    let score = 100;
    const rooms = f.rooms.filter((r) => r.type !== "CORRIDOR");
    const byOutline: Record<string, number> = {};
    const byConfidence: Record<Confidence, number> = { verified: 0, drawing: 0, assumed: 0 };
    for (const r of rooms) { const k = r.outlineSource ?? "unknown"; byOutline[k] = (byOutline[k] ?? 0) + 1; byConfidence[roomConfidence(r)]++; }

    if (!f.cad) {
      issues.push({ key: "no-drawing", severity: f.unitsPerMetre ? "low" : "medium", title: "No drawing",
        detail: f.unitsPerMetre ? "Rooms were drawn in the app; no walls, doors or glazing to check against." : "Rooms were drawn in the app without a scale, so areas and sizes are not real." });
      score -= f.unitsPerMetre ? 20 : 40;
    } else {
      const s = f.cad.segments;
      if (!s.walls) { issues.push({ key: "no-walls", severity: "high", title: "No wall layer found", detail: "No line was recognised as a wall: room outlines and routes can't be trusted." }); score -= 50; }
      if (!s.doors) { issues.push({ key: "no-doors", severity: "medium", title: "No door layer found", detail: "Routes assume doors where rooms meet corridors." }); score -= 10; }
      if (!s.glass) { issues.push({ key: "no-glass", severity: "low", title: "No glazing layer found", detail: "Windows and glass walls won't show." }); score -= 2; }
      if (!s.columns) { issues.push({ key: "no-columns", severity: "low", title: "No column layer found", detail: "Structural columns won't show or block placements." }); score -= 2; }
      if (usual != null && f.unitsPerMetre != null && Math.abs(f.unitsPerMetre - usual) > 1e-6) {
        issues.push({ key: "units", severity: "high", title: "Different scale from the other floors", detail: `${f.unitsPerMetre} plan units a metre against ${usual} on the others: check the drawing's units.` }); score -= 30;
      }
      const a = f.cad.alignment;
      if (!f.cad.reference) {
        if (!a) { issues.push({ key: "align-unknown", severity: "low", title: "Alignment not recorded", detail: "How well this floor lines up with the others isn't known." }); score -= 2; }
        else if (a.lifts < 2) { issues.push({ key: "align-few", severity: "medium", title: "Aligned on too few lifts", detail: `Only ${plural(a.lifts, "lift label")} matched the reference floor, so the floor may be shifted or turned.` }); score -= 10; }
        else if (a.residualMm > 200) { issues.push({ key: "align-off", severity: "medium", title: "Floors don't line up well", detail: `Lift positions differ by ${Math.round(a.residualMm)} mm on average from the reference floor.` }); score -= 8; }
      }
      const age = newest - Date.parse(f.cad.importedAt);
      if (age > 30 * DAY) { issues.push({ key: "outdated", severity: "medium", title: "Older than the other floors", detail: `Imported ${Math.round(age / DAY)} days before the newest floor: check it is the latest revision.` }); score -= 8; }
    }

    const ids = (src: string) => rooms.filter((r) => r.outlineSource === src).map((r) => r.id);
    const fallback = ids("fallback"), split = ids("split"), unknown = rooms.filter((r) => r.outlineSource == null).map((r) => r.id);
    if (fallback.length) { issues.push({ key: "fallback", severity: "high", title: `${plural(fallback.length, "room")} with no outline found`, detail: "A box around the room's label stands in for its walls: sizes are guesses.", roomIds: fallback }); score -= Math.min(30, 40 * fallback.length / Math.max(1, rooms.length) + 2 * fallback.length); }
    if (split.length) { issues.push({ key: "split", severity: "medium", title: `${plural(split.length, "room")} split from a shared open area`, detail: "The area was divided between the labels in it; the line between them is assumed.", roomIds: split }); score -= Math.min(15, (15 * split.length) / Math.max(1, rooms.length)); }
    if (f.cad && unknown.length) { issues.push({ key: "unrecorded", severity: "low", title: `${plural(unknown.length, "room")} with no recorded source`, detail: "Imported before sources were kept; re-import the drawings to record them.", roomIds: unknown }); score -= Math.min(5, unknown.length); }

    const small = rooms.filter((r) => f.unitsPerMetre && r.poly.length >= 3 && polyArea(r.poly) / f.unitsPerMetre ** 2 < 1).map((r) => r.id);
    if (small.length) { issues.push({ key: "tiny", severity: "medium", title: `${plural(small.length, "room")} under 1 m²`, detail: "Probably a label inside a wall or a broken outline.", roomIds: small }); score -= Math.min(10, 2 * small.length); }
    const ov = overlaps(rooms);
    if (ov.length) { issues.push({ key: "overlap", severity: "medium", title: `${plural(ov.length, "pair")} of overlapping rooms`, detail: "Two outlines cover the same space: a duplicate or a wrong boundary.", roomIds: [...new Set(ov.flat())] }); score -= Math.min(15, 3 * ov.length); }
    if (f.unreachable?.length) { issues.push({ key: "unreachable", severity: "medium", title: `${plural(f.unreachable.length, "room")} no door leads to`, detail: "The walking network can't reach them: a missing door or a gap in the walls. Fix it under Routes in the 3D view.", roomIds: f.unreachable }); score -= Math.min(15, (30 * f.unreachable.length) / Math.max(1, rooms.length)); }

    const s = Math.max(0, Math.min(100, Math.round(score)));
    const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    return { floorId: f.id, name: f.name, level: f.level, score: s, grade: s >= 85 ? "good" : s >= 60 ? "fair" : "poor", rooms: rooms.length, byConfidence, byOutline,
      issues: issues.sort((a, b) => order[a.severity] - order[b.severity]) };
  });
}

/** One line for a floor's confidence mix: "82 % from the drawing, 3 % verified". */
export function confidenceLine(r: FloorReport): string {
  const n = r.rooms;
  return n ? `${pct(r.byConfidence.drawing, n)} % from the drawing · ${pct(r.byConfidence.assumed, n)} % assumed · ${pct(r.byConfidence.verified, n)} % verified` : "No rooms";
}

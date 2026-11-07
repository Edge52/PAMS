/**
 * Presentation renders (wave 7, part F): what each room looks like when furnished. Pure.
 *
 * - `roomLook` reads a room's name and type into a floor finish and a furniture kit (the same name rules the CAD
 *   fit-out uses: "ICU (3)", "OPERATING ROOM", "NURSE STATION"…).
 * - `placeKit` puts the kit's items against the room's walls, facing in, clear of the doors and of each other; centre
 *   items (theatre table, scanner, meeting table) go in the middle. Everything is in metres on the floor plane.
 *
 * Kit furniture is illustrative: the render says so, and registered equipment with an exact spot keeps it.
 */
import { interiorPoint, pointInPolygon, polygonArea, type Pt } from "../geometry";
import kitsJson from "../../../../../seed-data/room-kits.json";

export type Finish = "vinyl" | "theatre" | "wet" | "wood" | "terrazzo" | "plant" | "concrete";
export const FINISH_COLORS: Record<Finish, string> = {
  vinyl: "#f4f0e7", theatre: "#d3e8e4", wet: "#dbe6ee", wood: "#c99e72", terrazzo: "#eeebe5", plant: "#cdd1d3", concrete: "#b4b9bd",
};

/** A piece of furniture or equipment the renderer knows how to draw (see furniture.ts). */
export type Model =
  | "bed" | "bedside" | "chair" | "armchair" | "sofa" | "desk" | "workstation" | "counter" | "shelving" | "cabinet" | "wc" | "basin"
  | "shower" | "or-table" | "or-light" | "anaesthesia" | "trolley" | "incubator" | "cot" | "couch" | "dental-chair" | "ct" | "xray" | "mri" | "mri-open" | "carm"
  | "waiting-row" | "meeting-table" | "dining-set" | "lab-bench" | "fridge" | "monitor" | "ventilator" | "iv-pole" | "plant" | "washer" | "person";

/** Footprint (width along the wall × depth into the room, metres) and how the item is placed. */
export const MODEL_SIZE: Record<Model, { w: number; d: number; place: "wall" | "centre" | "free" }> = {
  bed: { w: 1.05, d: 2.15, place: "wall" }, bedside: { w: 0.5, d: 0.5, place: "wall" }, chair: { w: 0.55, d: 0.55, place: "free" },
  armchair: { w: 0.8, d: 0.8, place: "wall" }, sofa: { w: 1.9, d: 0.85, place: "wall" }, desk: { w: 1.4, d: 0.7, place: "wall" },
  workstation: { w: 2.4, d: 0.75, place: "wall" }, counter: { w: 2.0, d: 0.65, place: "wall" }, shelving: { w: 1.8, d: 0.5, place: "wall" },
  cabinet: { w: 0.9, d: 0.5, place: "wall" }, wc: { w: 0.45, d: 0.7, place: "wall" }, basin: { w: 0.6, d: 0.45, place: "wall" },
  shower: { w: 0.9, d: 0.9, place: "wall" }, "or-table": { w: 0.6, d: 2.1, place: "centre" }, "or-light": { w: 1.4, d: 1.4, place: "free" },
  anaesthesia: { w: 0.75, d: 0.65, place: "free" }, trolley: { w: 0.9, d: 0.55, place: "wall" }, incubator: { w: 0.65, d: 1.05, place: "wall" },
  cot: { w: 0.55, d: 0.9, place: "wall" }, couch: { w: 0.7, d: 1.9, place: "wall" }, "dental-chair": { w: 0.8, d: 1.9, place: "centre" },
  ct: { w: 2.2, d: 4.6, place: "centre" }, mri: { w: 2.2, d: 4.4, place: "centre" }, "mri-open": { w: 2.2, d: 3.6, place: "centre" },
  carm: { w: 0.9, d: 2.0, place: "free" }, xray: { w: 1.0, d: 2.2, place: "centre" }, "waiting-row": { w: 2.0, d: 0.65, place: "wall" },
  "meeting-table": { w: 1.2, d: 2.4, place: "centre" }, "dining-set": { w: 1.6, d: 1.6, place: "centre" }, "lab-bench": { w: 2.4, d: 0.75, place: "wall" },
  fridge: { w: 0.7, d: 0.7, place: "wall" }, monitor: { w: 0.5, d: 0.4, place: "free" }, ventilator: { w: 0.55, d: 0.55, place: "free" },
  "iv-pole": { w: 0.45, d: 0.45, place: "free" }, plant: { w: 0.6, d: 0.6, place: "wall" }, washer: { w: 0.8, d: 0.8, place: "wall" },
  person: { w: 0.5, d: 0.35, place: "centre" },
};

/** A kit line: a model, how many (fixed, or one per so many m²), and an optional companion placed beside each one. */
export type KitLine = { model: Model; n?: number; perM2?: number; max?: number; with?: Model[] };
type Kit = { finish: Finish; items: KitLine[] };

/**
 * A kit rule (seed-data/room-kits.json, editable under Planning › Room kits): a room-name pattern (tested against the
 * upper-cased name) or a room type, the floor finish and the furniture. Name rules are tried in order first, then
 * room types.
 */
export type KitRule = { id?: number; label: string; match: string | null; roomType: string | null; finish: Finish; items: KitLine[] };
export const BUILTIN_KITS = (kitsJson as { kits: KitRule[] }).kits;
export const FINISHES = Object.keys(FINISH_COLORS) as Finish[];
export const MODELS = Object.keys(MODEL_SIZE) as Model[];

const compiled = new WeakMap<KitRule[], { re: RegExp | null; rule: KitRule }[]>();
function compile(rules: KitRule[]) {
  let c = compiled.get(rules);
  if (!c) {
    c = rules.map((rule) => { let re: RegExp | null = null; try { re = rule.match ? new RegExp(rule.match, "i") : null; } catch { re = null; } return { re, rule }; });
    compiled.set(rules, c);
  }
  return c;
}
const DEFAULT: Kit = { finish: "vinyl", items: [] };

export type RoomLook = { finish: Finish; items: KitLine[]; kit: string };

/** Finish and kit for a room from its name, then its type. `kit` names the rule that matched (for tests and debugging). */
export function roomLook(name: string, type?: string | null, rules: KitRule[] = BUILTIN_KITS): RoomLook {
  const n = name.toUpperCase();
  const c = compile(rules);
  for (const { re, rule } of c) if (re && re.test(n)) return { finish: rule.finish, items: rule.items, kit: rule.match! };
  if (type) for (const { rule } of c) if (!rule.match && rule.roomType === type) return { finish: rule.finish, items: rule.items, kit: `type:${type}` };
  return { ...DEFAULT, kit: "default" };
}

/* ── Kit lines as text, for the editor: "bed per 11 m2 max 4 with bedside, monitor" or "desk 2" ── */

export function formatItems(items: KitLine[]): string {
  return items.map((it) => [it.model, it.perM2 ? `per ${it.perM2} m2` : String(it.n ?? 1), it.perM2 && it.max ? `max ${it.max}` : "", it.with?.length ? `with ${it.with.join(", ")}` : ""]
    .filter(Boolean).join(" ")).join("\n");
}

/** Read the editor's text back; errors name the line. */
export function parseItems(text: string): { items: KitLine[]; errors: string[] } {
  const items: KitLine[] = [], errors: string[] = [];
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const m = /^([a-z-]+)(?:\s+(\d+)|\s+per\s+(\d+(?:\.\d+)?)\s*m2?(?:\s+max\s+(\d+))?)?(?:\s+with\s+([a-z-]+(?:\s*,\s*[a-z-]+)*))?$/i.exec(line);
    if (!m) { errors.push(`Line ${i + 1} (“${line}”): write it like “bed 2” or “bed per 11 m2 max 4 with bedside”.`); return; }
    const model = m[1].toLowerCase() as Model;
    if (!MODELS.includes(model)) { errors.push(`Line ${i + 1}: “${m[1]}” isn't a model. Models: ${MODELS.join(", ")}.`); return; }
    const withs = (m[5] ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as Model[];
    const bad = withs.find((w) => !MODELS.includes(w));
    if (bad) { errors.push(`Line ${i + 1}: “${bad}” isn't a model.`); return; }
    const it: KitLine = { model };
    if (m[3]) { it.perM2 = Number(m[3]); if (m[4]) it.max = Number(m[4]); } else it.n = m[2] ? Number(m[2]) : 1;
    if ((it.n ?? 1) > 40 || (it.max ?? 0) > 40 || (it.perM2 != null && it.perM2 < 1)) { errors.push(`Line ${i + 1}: keep counts to 40 and at least 1 m² each.`); return; }
    if (withs.length) it.with = withs;
    items.push(it);
  });
  return { items, errors };
}

/** One placed item: centre (metres), rotation about the vertical (radians; 0 = facing +z), and its model. */
export type Placement = { model: Model; x: number; z: number; rot: number; registered?: number; /** real size of a registered device, metres */ dims?: { l: number; w: number; h: number } };

type OBB = { x: number; z: number; hw: number; hd: number; rot: number };

/** Do two rotated rectangles overlap? (separating axis test, with a small clearance) */
export function obbOverlap(a: OBB, b: OBB, gap = 0.08): boolean {
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((r) => [Math.sin(r), Math.cos(r)] as const);
  const corners = (o: OBB) => {
    const s = Math.sin(o.rot), c = Math.cos(o.rot);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [o.x + i * (o.hw + gap / 2) * c + j * (o.hd + gap / 2) * s, o.z - i * (o.hw + gap / 2) * s + j * (o.hd + gap / 2) * c] as const);
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    const pa = ca.map(([x, z]) => x * ax + z * az), pb = cb.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}

function obbCorners(o: OBB): Pt[] {
  const s = Math.sin(o.rot), c = Math.cos(o.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([i, j]) => [o.x + i * o.hw * c + j * o.hd * s, o.z - i * o.hw * s + j * o.hd * c] as Pt);
}

/**
 * Furnish one room. `poly` and `doors` are in metres on the floor plane (x, z). Items go along the walls, longest wall
 * first, backs to the wall, facing in; every corner must be inside the room and at least `doorClear` from a door.
 * Companions (`with`) sit at the side of their item (a monitor and ventilator by a bed, a chair at a desk).
 * `taken` holds what's already in the room (registered equipment), so kit items keep clear of it.
 */
export function placeKit(poly: Pt[], look: RoomLook, doors: Pt[] = [], taken: Placement[] = [], doorClear = 1.0): Placement[] {
  if (poly.length < 3 || !look.items.length) return [];
  const area = polygonArea(poly);
  const placed: (Placement & { box: OBB })[] = taken.map((p) => ({ ...p, box: { x: p.x, z: p.z, hw: MODEL_SIZE[p.model].w / 2, hd: MODEL_SIZE[p.model].d / 2, rot: p.rot } }));
  const out: Placement[] = [];
  const fits = (b: OBB) => obbCorners(b).every((p) => pointInPolygon(p, poly))
    && doors.every(([dx, dz]) => Math.hypot(dx - b.x, dz - b.z) > doorClear + Math.min(b.hw, b.hd))
    && placed.every((q) => !obbOverlap(b, q.box));
  const put = (model: Model, b: OBB) => { const p = { model, x: b.x, z: b.z, rot: b.rot }; placed.push({ ...p, box: b }); out.push(p); };

  // Walls, longest first, with the inward normal (polygon winding decides which side is in).
  const signed = poly.reduce((s, [x1, z1], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return s + (x1 * z2 - x2 * z1); }, 0);
  const walls = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / (len || 1), uz = (b[1] - a[1]) / (len || 1);
    const [nx, nz] = signed > 0 ? [-uz, ux] : [uz, -ux];
    return { a, len, ux, uz, nx, nz };
  }).filter((w) => w.len >= 0.8).sort((p, q) => q.len - p.len);

  const alongWalls = (model: Model, companions: Model[]): boolean => {
    const { w, d } = MODEL_SIZE[model];
    const sideW = companions.reduce((s, m) => s + MODEL_SIZE[m].w + 0.1, 0);
    for (const wall of walls) {
      const span = w + sideW;
      if (wall.len < span + 0.2) continue;
      // Rotation that makes the item's front (+z) face the room.
      const rot = Math.atan2(wall.nx, wall.nz);
      for (let t = 0.25 + span / 2; t <= wall.len - 0.25 - span / 2 + 1e-6; t += 0.25) {
        const cx = wall.a[0] + wall.ux * (t - sideW / 2) + wall.nx * (d / 2 + 0.08);
        const cz = wall.a[1] + wall.uz * (t - sideW / 2) + wall.nz * (d / 2 + 0.08);
        const box = { x: cx, z: cz, hw: w / 2, hd: d / 2, rot };
        if (!fits(box)) continue;
        // Companions to the side, also against the wall.
        let off = w / 2 + 0.1;
        const extra: [Model, OBB][] = [];
        let ok = true;
        for (const m of companions) {
          const s = MODEL_SIZE[m];
          off += s.w / 2;
          const along = t - sideW / 2 + off;
          const cb = { x: wall.a[0] + wall.ux * along + wall.nx * (s.d / 2 + 0.12), z: wall.a[1] + wall.uz * along + wall.nz * (s.d / 2 + 0.12), hw: s.w / 2, hd: s.d / 2, rot };
          off += s.w / 2 + 0.1;
          if (!fits(cb) || obbOverlap(cb, box)) { ok = false; break; }
          extra.push([m, cb]);
        }
        if (!ok) continue;
        put(model, box);
        for (const [m, cb] of extra) put(m, cb);
        return true;
      }
    }
    return false;
  };

  const centreItem = (model: Model): boolean => {
    const { w, d } = MODEL_SIZE[model];
    const [cx, cz] = interiorPoint(poly);
    // Long side along the room's longest wall.
    const rot = walls.length ? Math.atan2(walls[0].ux, walls[0].uz) : 0;
    for (const r of [rot, rot + Math.PI / 2]) {
      const box = { x: cx, z: cz, hw: w / 2, hd: d / 2, rot: r };
      if (fits(box)) { put(model, box); return true; }
    }
    return false;
  };

  for (const line of look.items) {
    const n = line.n ?? Math.max(1, Math.min(line.max ?? 99, Math.floor(area / (line.perM2 ?? area))));
    const place = MODEL_SIZE[line.model].place;
    for (let i = 0; i < n; i++) {
      if (place === "centre") { if (!centreItem(line.model)) break; continue; }
      if (place === "free") {
        // Free items (theatre lights, anaesthesia machine) go beside the room's centre item, else near the middle.
        const anchor = out.find((p) => MODEL_SIZE[p.model].place === "centre") ?? { x: interiorPoint(poly)[0], z: interiorPoint(poly)[1], rot: 0 };
        const { w, d } = MODEL_SIZE[line.model];
        const offsets = [[1.2, 0.6], [-1.2, 0.6], [1.2, -0.8], [-1.2, -0.8], [0, 1.6], [0, -1.6]];
        let done = false;
        for (const [ox, oz] of offsets) {
          const s = Math.sin(anchor.rot), c = Math.cos(anchor.rot);
          const box = { x: anchor.x + ox * c + oz * s, z: anchor.z - ox * s + oz * c, hw: w / 2, hd: d / 2, rot: anchor.rot };
          if (line.model === "or-light" ? obbCorners(box).every((p) => pointInPolygon(p, poly)) : fits(box)) {
            if (line.model === "or-light") { out.push({ model: line.model, x: box.x, z: box.z, rot: box.rot }); } else put(line.model, box);
            done = true; break;
          }
        }
        if (!done) break;
        continue;
      }
      if (!alongWalls(line.model, line.with ?? [])) break;
    }
  }
  return out;
}

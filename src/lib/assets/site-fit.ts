/**
 * "Will it fit?" (wave 9, D1): a device model's site requirements against a room. Pure; metres.
 *
 * Checks, each ok / fail / unknown (the room hasn't been surveyed for it):
 * - footprint and service clearance inside the room's outline at the chosen spot and turn;
 * - room length, width and area against the minimums;
 * - clear ceiling height, door width and height;
 * - floor load: weight over the footprint against the room's rated load;
 * - services: chilled water, quench pipe, RF shielding, lead lining, power;
 * - MRI: the 0.5 mT (5 gauss) line, drawn as an ellipse round the magnet, and the rooms it reaches.
 */
export type Pt = [number, number];
export type SiteReq = {
  lengthM: number; widthM: number; heightM?: number | null; clearanceM: number;
  minRoomLengthM?: number | null; minRoomWidthM?: number | null; minAreaM2?: number | null; minCeilingM?: number | null;
  doorWidthM?: number | null; doorHeightM?: number | null; weightKg?: number | null; powerKva?: number | null; heatKw?: number | null;
  chilledWater?: boolean; quenchPipe?: boolean; rfShield?: boolean; leadLined?: boolean;
  fringeAlongM?: number | null; fringeAcrossM?: number | null;
};
export type SiteRoom = {
  id: number; name: string; poly: Pt[];
  ceilingM?: number | null; doorWidthM?: number | null; doorHeightM?: number | null; floorLoadKgM2?: number | null;
  services?: { chilledWater?: boolean; quenchPipe?: boolean; rfShield?: boolean; leadLined?: boolean; powerKva?: number } | null;
};
export type Check = { key: string; label: string; status: "ok" | "fail" | "unknown"; detail: string };
export type Placement = { x: number; z: number; rot: number };
export type FitResult = { checks: Check[]; fits: boolean; unknown: number; placement: Placement; footprint: Pt[]; clearance: Pt[]; fringe: Pt[] | null; fringeRooms: { id: number; name: string }[] };

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export const polygonArea = (p: Pt[]) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);

/** A rectangle's corners: centre, length along the turn (rot radians from +x), width across. */
export function rect(c: Placement, l: number, w: number): Pt[] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  return [[-l / 2, -w / 2], [l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2]].map(([a, b]) => [c.x + a * cs - b * sn, c.z + a * sn + b * cs] as Pt);
}
/** Is a polygon (sampled along its edges) inside another? */
export function inside(shape: Pt[], room: Pt[], step = 0.2): boolean {
  for (let i = 0; i < shape.length; i++) {
    const [ax, az] = shape[i], [bx, bz] = shape[(i + 1) % shape.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k <= n; k++) if (!pointInPolygon([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n], room)) return false;
  }
  return true;
}
/** Length and width of the room's minimum-area bounding rectangle (from its edges' directions). */
export function roomSize(poly: Pt[]): { length: number; width: number; angle: number } {
  let best = { length: 0, width: 0, angle: 0, area: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const ang = Math.atan2(bz - az, bx - ax), c = Math.cos(-ang), s = Math.sin(-ang);
    const xs = poly.map(([x, z]) => x * c - z * s), zs = poly.map(([x, z]) => x * s + z * c);
    const L = Math.max(...xs) - Math.min(...xs), W = Math.max(...zs) - Math.min(...zs);
    if (L * W < best.area) best = { length: Math.max(L, W), width: Math.min(L, W), angle: L >= W ? ang : ang + Math.PI / 2, area: L * W };
  }
  return { length: best.length, width: best.width, angle: best.angle };
}
/** Area centroid (the vertex average leans towards detailed walls). */
function centroid(p: Pt[]): Pt {
  let a = 0, x = 0, z = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length], c = x0 * z1 - x1 * z0;
    a += c; x += (x0 + x1) * c; z += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-9) { const s = p.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]); return [s[0] / p.length, s[1] / p.length]; }
  return [x / (3 * a), z / (3 * a)];
}

/**
 * The best spot: the one nearest the room's middle where the equipment and its service space fit, trying it along and
 * across the room's longer side (and square to the plan). Falls back to where the equipment alone fits, then the middle.
 */
export function autoPlacement(req: SiteReq, room: SiteRoom): Placement {
  const [cx, cz] = centroid(room.poly);
  const { angle } = roomSize(room.poly);
  const rots = [angle, angle + Math.PI / 2, 0, Math.PI / 2];
  const xs = room.poly.map((p) => p[0]), zs = room.poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const step = Math.max(0.2, Math.min(x1 - x0, z1 - z0) / 24);
  const L = req.lengthM + 2 * req.clearanceM, W = req.widthM + 2 * req.clearanceM;
  let best: { p: Placement; d: number; full: boolean } | null = null;
  for (const rot of rots) for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    if (!pointInPolygon([x, z], room.poly)) continue;
    const d = Math.hypot(x - cx, z - cz) + (rot === angle ? 0 : 0.01);
    const p = { x, z, rot };
    const quick = (r: Pt[]) => r.every((q) => pointInPolygon(q, room.poly));
    const big = rect(p, L, W);
    if (quick(big) && inside(big, room.poly)) { if (!best || !best.full || d < best.d) best = { p, d, full: true }; continue; }
    if (best?.full) continue;
    const small = rect(p, req.lengthM, req.widthM);
    if (quick(small) && inside(small, room.poly) && (!best || d < best.d)) best = { p, d, full: false };
  }
  return best?.p ?? { x: cx, z: cz, rot: angle };
}

export function ellipse(c: Placement, along: number, across: number, n = 48): Pt[] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  return Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; const a = along * Math.cos(t), b = across * Math.sin(t); return [c.x + a * cs - b * sn, c.z + a * sn + b * cs] as Pt; });
}

const m = (v: number) => `${Math.round(v * 100) / 100} m`;
export function checkFit(req: SiteReq, room: SiteRoom, others: SiteRoom[] = [], at?: Placement): FitResult {
  const p = at ?? autoPlacement(req, room);
  const footprint = rect(p, req.lengthM, req.widthM);
  const clearance = rect(p, req.lengthM + 2 * req.clearanceM, req.widthM + 2 * req.clearanceM);
  const checks: Check[] = [];
  const add = (key: string, label: string, status: Check["status"], detail: string) => checks.push({ key, label, status, detail });
  const size = roomSize(room.poly), area = polygonArea(room.poly);

  add("footprint", "Equipment and service space", inside(clearance, room.poly) ? "ok" : inside(footprint, room.poly) ? "fail" : "fail",
    inside(clearance, room.poly) ? `${m(req.lengthM)} × ${m(req.widthM)} with ${m(req.clearanceM)} all round fits here.`
      : inside(footprint, room.poly) ? `The equipment fits but not its ${m(req.clearanceM)} service space; move or turn it.` : "The equipment itself doesn't fit at this spot.");
  if (req.minRoomLengthM || req.minRoomWidthM) {
    const okL = !req.minRoomLengthM || size.length + 1e-6 >= req.minRoomLengthM, okW = !req.minRoomWidthM || size.width + 1e-6 >= req.minRoomWidthM;
    add("room", "Room length and width", okL && okW ? "ok" : "fail", `Room ${m(size.length)} × ${m(size.width)}; needs ${req.minRoomLengthM ? m(req.minRoomLengthM) : "—"} × ${req.minRoomWidthM ? m(req.minRoomWidthM) : "—"}.`);
  }
  if (req.minAreaM2) add("area", "Room area", area + 1e-6 >= req.minAreaM2 ? "ok" : "fail", `${Math.round(area * 10) / 10} m²; needs ${req.minAreaM2} m².`);
  const vs = (key: string, label: string, need: number | null | undefined, have: number | null | undefined, unit: string, more = true) => {
    if (!need) return;
    if (have == null) add(key, label, "unknown", `Needs ${need} ${unit}; not surveyed for this room.`);
    else add(key, label, (more ? have + 1e-6 >= need : have <= need + 1e-6) ? "ok" : "fail", `${have} ${unit}; needs ${need} ${unit}.`);
  };
  vs("ceiling", "Clear ceiling height", req.minCeilingM, room.ceilingM, "m");
  vs("doorW", "Door clear width", req.doorWidthM, room.doorWidthM, "m");
  vs("doorH", "Door clear height", req.doorHeightM, room.doorHeightM, "m");
  if (req.weightKg) {
    const per = req.weightKg / Math.max(0.1, req.lengthM * req.widthM);
    if (room.floorLoadKgM2 == null) add("load", "Floor load", "unknown", `${Math.round(per)} kg/m² over the footprint (${req.weightKg} kg); the room's rated load isn't recorded.`);
    else add("load", "Floor load", per <= room.floorLoadKgM2 ? "ok" : "fail", `${Math.round(per)} kg/m² over the footprint; the floor takes ${room.floorLoadKgM2} kg/m².`);
  }
  const svc = room.services ?? null;
  const need = (key: keyof NonNullable<SiteRoom["services"]>, label: string, wanted?: boolean) => {
    if (!wanted) return;
    add(key, label, svc == null || svc[key] == null ? "unknown" : svc[key] ? "ok" : "fail", svc?.[key] ? "Present." : svc == null || svc[key] == null ? "Needed; not recorded for this room." : "Needed; not present.");
  };
  need("chilledWater", "Chilled water", req.chilledWater);
  need("quenchPipe", "Quench pipe route", req.quenchPipe);
  need("rfShield", "RF shielding", req.rfShield);
  need("leadLined", "Radiation shielding (lead)", req.leadLined);
  if (req.powerKva) vs("power", "Electrical supply", req.powerKva, svc?.powerKva ?? null, "kVA");
  if (req.heatKw) add("heat", "Heat to remove", "unknown", `${req.heatKw} kW from the equipment; check the room's cooling.`);

  let fringe: Pt[] | null = null; const fringeRooms: { id: number; name: string }[] = [];
  if (req.fringeAlongM && req.fringeAcrossM) {
    fringe = ellipse(p, req.fringeAlongM, req.fringeAcrossM);
    for (const r of others) {
      if (r.id === room.id) continue;
      if (fringe.some((q) => pointInPolygon(q, r.poly)) || r.poly.some((q) => pointInEllipse(q, p, req.fringeAlongM!, req.fringeAcrossM!))) fringeRooms.push({ id: r.id, name: r.name });
    }
    const outside = !fringe.every((q) => pointInPolygon(q, room.poly));
    add("fringe", "5 gauss line", outside ? (fringeRooms.length ? "fail" : "ok") : "ok",
      !outside ? "Stays inside the room." : fringeRooms.length ? `Reaches ${fringeRooms.slice(0, 4).map((r) => r.name).join(", ")}${fringeRooms.length > 4 ? ` and ${fringeRooms.length - 4} more` : ""}: control access or move the magnet.` : "Leaves the room but reaches no other room on this floor.");
  }
  const fits = checks.every((c) => c.status !== "fail");
  return { checks, fits, unknown: checks.filter((c) => c.status === "unknown").length, placement: p, footprint, clearance, fringe, fringeRooms };
}

function pointInEllipse([x, z]: Pt, c: Placement, a: number, b: number) {
  const dx = x - c.x, dz = z - c.z, cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
  const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
  return (u * u) / (a * a) + (v * v) / (b * b) <= 1;
}

/**
 * Typical planning values by modality, to start from when a model's guide isn't to hand. They're rough and are
 * saved marked "typical — replace with the manufacturer's site planning guide".
 */
export const TYPICAL: Record<string, { label: string; req: SiteReq }> = {
  ct: { label: "CT scanner", req: { lengthM: 4.6, widthM: 2.2, heightM: 1.9, clearanceM: 0.8, minRoomLengthM: 6.5, minRoomWidthM: 4.5, minCeilingM: 2.7, doorWidthM: 1.2, doorHeightM: 2.1, weightKg: 2500, powerKva: 100, heatKw: 10, leadLined: true } },
  mri: { label: "MRI 1.5 T", req: { lengthM: 2.4, widthM: 2.1, heightM: 2.4, clearanceM: 1.0, minRoomLengthM: 7.0, minRoomWidthM: 4.5, minCeilingM: 2.9, doorWidthM: 1.2, doorHeightM: 2.2, weightKg: 4500, powerKva: 100, heatKw: 30, chilledWater: true, quenchPipe: true, rfShield: true, fringeAlongM: 4.0, fringeAcrossM: 2.5 } },
  xray: { label: "Digital X-ray room", req: { lengthM: 2.3, widthM: 1.0, heightM: 2.0, clearanceM: 0.8, minRoomLengthM: 5.0, minRoomWidthM: 4.0, minCeilingM: 2.8, doorWidthM: 1.2, doorHeightM: 2.1, weightKg: 800, powerKva: 80, heatKw: 3, leadLined: true } },
  "mri-open": { label: "Open MRI (low field)", req: { lengthM: 2.2, widthM: 2.0, heightM: 2.3, clearanceM: 0.8, minRoomLengthM: 6.0, minRoomWidthM: 4.0, minCeilingM: 2.6, doorWidthM: 1.2, doorHeightM: 2.1, powerKva: 30, heatKw: 5, rfShield: true, fringeAlongM: 2.5, fringeAcrossM: 2.0 } },
  carm: { label: "Mobile C-arm", req: { lengthM: 2.0, widthM: 0.9, heightM: 1.9, clearanceM: 1.0, minAreaM2: 36, doorWidthM: 1.0, doorHeightM: 2.0, weightKg: 350, powerKva: 3, heatKw: 1, leadLined: true } },
  angio: { label: "Angiography (ceiling-mounted)", req: { lengthM: 4.0, widthM: 3.0, heightM: 2.5, clearanceM: 1.0, minRoomLengthM: 7.5, minRoomWidthM: 6.0, minCeilingM: 3.0, doorWidthM: 1.4, doorHeightM: 2.2, weightKg: 2000, powerKva: 120, heatKw: 12, leadLined: true } },
};

/** One line per figure, for the model page and the readiness sheet. */
export function siteSummary(r: SiteReq & { heatKw?: number | null }): string[] {
  const o: string[] = [`Footprint ${r.lengthM} × ${r.widthM} m${r.heightM ? `, ${r.heightM} m high` : ""}, ${r.clearanceM} m service space`];
  if (r.minRoomLengthM || r.minRoomWidthM) o.push(`Room at least ${r.minRoomLengthM ?? "—"} × ${r.minRoomWidthM ?? "—"} m`);
  if (r.minAreaM2) o.push(`Room area at least ${r.minAreaM2} m²`);
  if (r.minCeilingM) o.push(`Clear ceiling ${r.minCeilingM} m`);
  if (r.doorWidthM || r.doorHeightM) o.push(`Door ${r.doorWidthM ?? "—"} × ${r.doorHeightM ?? "—"} m clear`);
  if (r.weightKg) o.push(`Weight ${r.weightKg} kg (${Math.round(r.weightKg / (r.lengthM * r.widthM))} kg/m² over the footprint)`);
  if (r.powerKva) o.push(`Power ${r.powerKva} kVA`);
  if (r.heatKw) o.push(`Heat ${r.heatKw} kW`);
  const needs = [r.chilledWater && "chilled water", r.quenchPipe && "quench pipe", r.rfShield && "RF shielding", r.leadLined && "lead shielding"].filter(Boolean);
  if (needs.length) o.push(`Needs ${needs.join(", ")}`);
  if (r.fringeAlongM && r.fringeAcrossM) o.push(`5 gauss line ${r.fringeAlongM} m along, ${r.fringeAcrossM} m across`);
  return o;
}

/** How far a model's site data can be trusted: checked against the maker's guide, entered but unchecked, or typical values. */
export type SiteDataState = "verified" | "entered" | "typical" | "none";
export const SITE_DATA_LABELS: Record<SiteDataState, string> = { verified: "Verified", entered: "Entered, not checked", typical: "Typical values", none: "None" };

export function siteDataState(site: { source?: string | null; verified: boolean } | null | undefined): SiteDataState {
  if (!site) return "none";
  if (site.verified) return "verified";
  return site.source?.toLowerCase().startsWith("typical") ? "typical" : "entered";
}

/** Counts per state, to show how many figures still need the maker's guide. */
export function countSiteData(list: ({ source?: string | null; verified: boolean } | null | undefined)[]): Record<SiteDataState, number> {
  const n: Record<SiteDataState, number> = { verified: 0, entered: 0, typical: 0, none: 0 };
  for (const s of list) n[siteDataState(s)]++;
  return n;
}

/**
 * Space planning (wave 17, 3D roadmap phase 6): area schedules per floor and department, net-to-gross, circulation
 * share, equipment density and room capacity, and the comparison of two schedules (before and after). Pure.
 *
 * Areas come from the room outlines. Gross is traced from the rooms on a 0.5 m grid with the walls between them
 * closed (gross internal area); circulation is corridors (and lobbies); cores are stairs, lifts and shafts; net is
 * everything else.
 */
type Pt = [number, number];

export type SpaceRoom = {
  id: number; floorId: number; code: string; name: string; type: string; departmentId: number | null; beds: number;
  /** Outline in metres. */
  poly: Pt[];
  devices: number;
  /** The room template's minimum area (per bed space when the room has beds), m²; null = no template area. */
  minAreaM2: number | null;
  core: boolean;
};
export type SpaceFloor = { id: number; name: string; level: number };

export const polyArea = (p: Pt[]) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(a / 2); };

const isCirculation = (r: { type: string; name: string }) => r.type === "CORRIDOR" || /\b(corridor|lobby|hall ?way|passage)\b/i.test(r.name);

function inside([x, y]: Pt, p: Pt[]) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Gross internal area of a floor (m²): the rooms rasterised, wall gaps up to about 2 cells closed. */
export function grossArea(polys: Pt[][], cell = 0.5): number {
  const all = polys.filter((p) => p.length >= 3);
  if (!all.length) return 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of all) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 3, nx = Math.ceil((x1 - x0) / cell) + pad * 2, ny = Math.ceil((y1 - y0) / cell) + pad * 2;
  if (nx * ny > 4_000_000) return all.reduce((t, p) => t + polyArea(p), 0); // too large to trace: the rooms' sum
  const ox = x0 - pad * cell, oy = y0 - pad * cell;
  let g = new Uint8Array(nx * ny);
  for (const p of all) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of p) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    for (let j = Math.max(0, Math.floor((b - oy) / cell)); j <= Math.min(ny - 1, Math.floor((d - oy) / cell)); j++)
      for (let i = Math.max(0, Math.floor((a - ox) / cell)); i <= Math.min(nx - 1, Math.floor((c - ox) / cell)); i++)
        if (!g[j * nx + i] && inside([ox + (i + 0.5) * cell, oy + (j + 0.5) * cell], p)) g[j * nx + i] = 1;
  }
  const morph = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(src.length);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      let v = grow ? 0 : 1;
      for (let dj = -1; dj <= 1 && (grow ? !v : v); dj++) for (let di = -1; di <= 1; di++) {
        const s = src[(j + dj) * nx + i + di];
        if (grow && s) { v = 1; break; } if (!grow && !s) { v = 0; break; }
      }
      out[j * nx + i] = v;
    }
    return out;
  };
  g = morph(morph(g, true), false);
  let n = 0; for (const v of g) n += v;
  return n * cell * cell;
}

export type FloorSchedule = { floorId: number; name: string; level: number; gross: number; net: number; circulation: number; cores: number; rooms: number; netToGross: number | null; circulationShare: number | null };
export type CapacityIssue = { id: number; code: string; name: string; area: number; beds: number; capacity: number };
export type DepartmentSchedule = {
  departmentId: number | null; name: string; rooms: number; net: number; circulation: number; beds: number; devices: number;
  /** Devices per 100 m² of net area. */
  density: number | null;
  /** Net area by room type, largest first. */
  byType: { type: string; area: number; rooms: number }[];
  /** Beds the rooms with a template could hold at the template's area per bed space, and the beds they have. */
  capacity: { rooms: number; beds: number; places: number; over: CapacityIssue[] };
  floors: string[];
};
export type SpaceSchedule = { floors: FloorSchedule[]; departments: DepartmentSchedule[]; totals: { gross: number; net: number; circulation: number; cores: number; beds: number; devices: number; rooms: number } };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The schedule of one hospital. Departments in the order given; rooms with no department under "No department". */
export function spaceSchedule(floors: SpaceFloor[], rooms: SpaceRoom[], departments: { id: number; name: string }[]): SpaceSchedule {
  const fl: FloorSchedule[] = floors.map((f) => {
    const mine = rooms.filter((r) => r.floorId === f.id && r.poly.length >= 3);
    let net = 0, circ = 0, cores = 0;
    for (const r of mine) { const a = polyArea(r.poly); if (r.core) cores += a; else if (isCirculation(r)) circ += a; else net += a; }
    const gross = Math.max(grossArea(mine.map((r) => r.poly)), net + circ + cores);
    return { floorId: f.id, name: f.name, level: f.level, gross: r1(gross), net: r1(net), circulation: r1(circ), cores: r1(cores), rooms: mine.length,
      netToGross: gross ? net / gross : null, circulationShare: gross ? circ / gross : null };
  });
  const floorName = new Map(floors.map((f) => [f.id, f.name]));
  const groups: { departmentId: number | null; name: string }[] = [...departments.map((d) => ({ departmentId: d.id, name: d.name })), { departmentId: null, name: "No department" }];
  const deps: DepartmentSchedule[] = groups.map((g) => {
    const mine = rooms.filter((r) => r.departmentId === g.departmentId && r.poly.length >= 3 && !r.core);
    const types = new Map<string, { area: number; rooms: number }>();
    let net = 0, circ = 0, beds = 0, devices = 0, capRooms = 0, capBeds = 0, places = 0;
    const over: CapacityIssue[] = [];
    for (const r of mine) {
      const a = polyArea(r.poly);
      devices += r.devices; beds += r.beds;
      if (isCirculation(r)) { circ += a; continue; }
      net += a;
      const t = types.get(r.type) ?? { area: 0, rooms: 0 }; t.area += a; t.rooms++; types.set(r.type, t);
      if (r.beds > 0 && r.minAreaM2) {
        const cap = Math.floor(a / r.minAreaM2 + 1e-9);
        capRooms++; capBeds += r.beds; places += cap;
        if (r.beds > cap) over.push({ id: r.id, code: r.code, name: r.name, area: r1(a), beds: r.beds, capacity: cap });
      }
    }
    return {
      departmentId: g.departmentId, name: g.name, rooms: mine.length, net: r1(net), circulation: r1(circ), beds, devices,
      density: net > 0 ? Math.round((devices / net) * 1000) / 10 : null,
      byType: [...types.entries()].map(([type, v]) => ({ type, area: r1(v.area), rooms: v.rooms })).sort((a, b) => b.area - a.area),
      capacity: { rooms: capRooms, beds: capBeds, places, over: over.sort((a, b) => (b.beds - b.capacity) - (a.beds - a.capacity)) },
      floors: [...new Set(mine.map((r) => floorName.get(r.floorId) ?? ""))].filter(Boolean),
    };
  }).filter((d) => d.rooms > 0);
  const sum = (k: "gross" | "net" | "circulation" | "cores") => r1(fl.reduce((t, f) => t + f[k], 0));
  return { floors: fl, departments: deps, totals: { gross: sum("gross"), net: sum("net"), circulation: sum("circulation"), cores: sum("cores"),
    beds: rooms.reduce((t, r) => t + r.beds, 0), devices: rooms.reduce((t, r) => t + r.devices, 0), rooms: rooms.length } };
}

/** What a saved schedule keeps (the comparison needs no room outlines). */
export type SnapshotData = { floors: Omit<FloorSchedule, "floorId">[]; departments: Pick<DepartmentSchedule, "departmentId" | "name" | "rooms" | "net" | "beds" | "devices" | "density">[]; totals: SpaceSchedule["totals"] };
export function toSnapshot(s: SpaceSchedule): SnapshotData {
  return {
    floors: s.floors.map(({ floorId: _f, ...f }) => { void _f; return f; }),
    departments: s.departments.map((d) => ({ departmentId: d.departmentId, name: d.name, rooms: d.rooms, net: d.net, beds: d.beds, devices: d.devices, density: d.density })),
    totals: s.totals,
  };
}

export type DiffRow = { key: string; label: string; before: { net: number; rooms: number; beds: number; devices: number } | null; after: { net: number; rooms: number; beds: number; devices: number } | null };

/** Departments before and after, matched by department (then by name): added, removed and changed. */
export function compareSchedules(before: SnapshotData, after: SnapshotData): { departments: DiffRow[]; floors: { name: string; before: number | null; after: number | null; beforeNtg: number | null; afterNtg: number | null }[]; totals: { before: SnapshotData["totals"]; after: SnapshotData["totals"] } } {
  const key = (d: { departmentId: number | null; name: string }) => (d.departmentId != null ? `d${d.departmentId}` : `n${d.name.toLowerCase()}`);
  const pick = (d: SnapshotData["departments"][number]) => ({ net: d.net, rooms: d.rooms, beds: d.beds, devices: d.devices });
  const b = new Map(before.departments.map((d) => [key(d), d])), a = new Map(after.departments.map((d) => [key(d), d]));
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const departments = keys.map((k) => ({ key: k, label: (a.get(k) ?? b.get(k))!.name, before: b.has(k) ? pick(b.get(k)!) : null, after: a.has(k) ? pick(a.get(k)!) : null }))
    .sort((x, y) => Math.abs((y.after?.net ?? 0) - (y.before?.net ?? 0)) - Math.abs((x.after?.net ?? 0) - (x.before?.net ?? 0)) || x.label.localeCompare(y.label));
  const fnames = [...new Set([...after.floors.map((f) => f.name), ...before.floors.map((f) => f.name)])];
  const floors = fnames.map((n) => { const x = before.floors.find((f) => f.name === n), y = after.floors.find((f) => f.name === n);
    return { name: n, before: x?.net ?? null, after: y?.net ?? null, beforeNtg: x?.netToGross ?? null, afterNtg: y?.netToGross ?? null }; });
  return { departments, floors, totals: { before: before.totals, after: after.totals } };
}

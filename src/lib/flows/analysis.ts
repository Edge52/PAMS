/**
 * Pathway analysis (wave 7, step 7d). Pure; every figure is an estimate and carries the formula it came from, so the
 * pages can show it on hover. See docs/pathway-analysis.md for a worked example.
 *
 * - Patients at a step: daily volume × the shares along the way (stepVolumes).
 * - Room load at the peak hour: for each hour, patients arriving that hour × minutes at the step ÷ 60 (the average
 *   number there at once, Little's law), summed over pathways; the busiest hour ÷ rooms. Flag above 85 %.
 *   Simplification: a patient is counted at every step in the hour they enter the pathway (no delay between steps).
 * - Beds needed: patients a day × hours in bed ÷ 24, for stays of 12 hours or more, against beds in that department.
 * - Scanner load: exams a year (patients a day × 365) against devices × yearly capacity per device. Flag above 85 %.
 * - Lift load (3D view, needs routes): lift trips in the peak hour × round-trip time ÷ (cars × 3600 s). Flag above 70 %.
 */
import { EVEN_PROFILE, stepVolumes, type Link, type Step } from "./model";

export const ROOM_FLAG = 0.85, SCANNER_FLAG = 0.85, LIFT_FLAG = 0.7;
/** Stays this long or longer are bed stays (beds needed), shorter ones room use (room load). */
export const BED_STAY_MIN = 12 * 60;

/** Room types that count as places where a step's care happens, when the step names only a department. */
export const CARE_ROOM_TYPES = new Set(["PATIENT_ROOM", "WARD", "ICU_BAY", "OPERATING_ROOM", "PROCEDURE_ROOM", "IMAGING_ROOM", "CONSULTATION"]);

/** Yearly exams one device handles (the reviewed figures used for BOQ questions). */
export const SCANNERS: { prefix: string; label: string; perYear: number }[] = [
  { prefix: "IMG-CT", label: "CT", perYear: 12000 },
  { prefix: "IMG-MR", label: "MRI", perYear: 6000 },
  { prefix: "IMG-XR", label: "X-ray", perYear: 10000 },
  { prefix: "IMG-US", label: "Ultrasound", perYear: 6000 },
];

export type AFlow = { id: number; name: string; dailyVolume: number | null; arrivalProfile: number[] | null; steps: Step[]; links: Link[] };
export type ARoom = { id: number; name: string; type: string; departmentId: number | null };
export type ADept = { id: number; name: string };
export type AAsset = { roomId: number | null; typeCode: string };

const profileOf = (f: AFlow) => (f.arrivalProfile?.length === 24 ? f.arrivalProfile : EVEN_PROFILE);
const pct = (x: number) => `${Math.round(x * 100)} %`;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The place a step uses: its room, or its department. */
type Place = { key: string; label: string; roomIds: number[]; departmentId: number | null };
function placeOf(s: Step, rooms: ARoom[], depts: ADept[]): Place | null {
  if (s.roomId != null) {
    const r = rooms.find((x) => x.id === s.roomId); if (!r) return null;
    return { key: `r${r.id}`, label: r.name, roomIds: [r.id], departmentId: r.departmentId };
  }
  if (s.departmentId != null) {
    const d = depts.find((x) => x.id === s.departmentId);
    const care = rooms.filter((r) => r.departmentId === s.departmentId && CARE_ROOM_TYPES.has(r.type));
    return { key: `d${s.departmentId}`, label: d?.name ?? "Department", roomIds: care.map((r) => r.id), departmentId: s.departmentId };
  }
  return null;
}

export type LoadRow = {
  place: string; steps: string[]; patientsPerDay: number; peakHour: number; atOncePeak: number; rooms: number;
  utilisation: number | null; flag: boolean; formula: string;
};
export type BedRow = { department: string; steps: string[]; patientsPerDay: number; bedsNeeded: number; beds: number; source: "devices" | "rooms"; flag: boolean; formula: string };
export type ScannerRow = { place: string; modality: string; examsPerYear: number; devices: number; capacity: number; utilisation: number | null; flag: boolean; formula: string };
export type Analysis = { load: LoadRow[]; beds: BedRow[]; scanners: ScannerRow[]; skipped: string[] };

/** Room load, beds and scanners across pathways (usually every published pathway of a hospital). */
export function analyse(flows: AFlow[], rooms: ARoom[], depts: ADept[], assets: AAsset[]): Analysis {
  const load = new Map<string, { place: Place; steps: Set<string>; perDay: number; hourly: number[] }>();
  const beds = new Map<number, { steps: Set<string>; perDay: number; bedDays: number }>();
  const scans = new Map<string, { place: Place; modality: (typeof SCANNERS)[number]; perDay: number }>();
  const skipped: string[] = [];
  for (const f of flows) {
    if (!f.dailyVolume) { skipped.push(`${f.name}: no patients a day set`); continue; }
    const vol = stepVolumes(f.steps, f.links, f.dailyVolume);
    const prof = profileOf(f);
    for (const s of f.steps) {
      if (s.kind !== "STEP") continue;
      const n = vol.get(s.key) ?? 0; if (n <= 0) continue;
      const pl = placeOf(s, rooms, depts);
      if (!pl) { skipped.push(`${f.name} › ${s.label}: no place`); continue; }
      const tag = `${s.label} (${f.name})`;
      if ((s.minutes ?? 0) >= BED_STAY_MIN && pl.departmentId != null) {
        const b = beds.get(pl.departmentId) ?? beds.set(pl.departmentId, { steps: new Set(), perDay: 0, bedDays: 0 }).get(pl.departmentId)!;
        b.steps.add(tag); b.perDay += n; b.bedDays += (n * s.minutes!) / 1440;
      } else if (s.minutes) {
        const e = load.get(pl.key) ?? load.set(pl.key, { place: pl, steps: new Set(), perDay: 0, hourly: Array(24).fill(0) }).get(pl.key)!;
        e.steps.add(tag); e.perDay += n;
        for (let h = 0; h < 24; h++) e.hourly[h] += (n * prof[h] * s.minutes) / 60;
      }
      for (const m of SCANNERS) if (s.equipment.some((c) => c === m.prefix || c.startsWith(`${m.prefix}-`))) {
        const k = `${pl.key}|${m.prefix}`;
        const e = scans.get(k) ?? scans.set(k, { place: pl, modality: m, perDay: 0 }).get(k)!;
        e.perDay += n;
      }
    }
  }
  const inRooms = (ids: number[], pred: (code: string) => boolean) => assets.filter((a) => a.roomId != null && ids.includes(a.roomId) && pred(a.typeCode)).length;
  return {
    skipped,
    load: [...load.values()].map(({ place, steps, perDay, hourly }) => {
      const peak = Math.max(...hourly); const peakHour = hourly.indexOf(peak); const n = place.roomIds.length;
      const u = n ? peak / n : null;
      return {
        place: place.label, steps: [...steps], patientsPerDay: r1(perDay), peakHour, atOncePeak: r1(peak), rooms: n, utilisation: u, flag: u != null && u > ROOM_FLAG,
        formula: `Busiest hour ${String(peakHour).padStart(2, "0")}:00: patients arriving that hour × minutes at the step ÷ 60 = ${r1(peak)} at once, ÷ ${n} room${n === 1 ? "" : "s"}${u != null ? ` = ${pct(u)}` : ""}. Flag above ${pct(ROOM_FLAG)}.`,
      };
    }).sort((a, b) => (b.utilisation ?? -1) - (a.utilisation ?? -1)),
    beds: [...beds.entries()].map(([deptId, b]) => {
      const ids = rooms.filter((r) => r.departmentId === deptId).map((r) => r.id);
      const devices = inRooms(ids, (c) => c.startsWith("FUR-BED"));
      const bedRooms = rooms.filter((r) => r.departmentId === deptId && ["PATIENT_ROOM", "WARD", "ICU_BAY"].includes(r.type)).length;
      const have = devices || bedRooms;
      return {
        department: depts.find((d) => d.id === deptId)?.name ?? "Department", steps: [...b.steps], patientsPerDay: r1(b.perDay),
        bedsNeeded: r1(b.bedDays), beds: have, source: devices ? "devices" as const : "rooms" as const, flag: b.bedDays > have,
        formula: `Patients a day × days in bed = ${r1(b.bedDays)} beds occupied on average, against ${have} ${devices ? "beds registered" : "bed rooms (no beds registered)"} in the department.`,
      };
    }).sort((a, b) => b.bedsNeeded / Math.max(1, b.beds) - a.bedsNeeded / Math.max(1, a.beds)),
    scanners: [...scans.values()].map(({ place, modality, perDay }) => {
      let devices = inRooms(place.roomIds, (c) => c.startsWith(modality.prefix));
      if (!devices && place.departmentId != null) devices = inRooms(rooms.filter((r) => r.departmentId === place.departmentId).map((r) => r.id), (c) => c.startsWith(modality.prefix));
      const year = perDay * 365, cap = devices * modality.perYear, u = cap ? year / cap : null;
      return {
        place: place.label, modality: modality.label, examsPerYear: Math.round(year), devices, capacity: cap, utilisation: u, flag: u == null || u > SCANNER_FLAG,
        formula: `${r1(perDay)} exams a day × 365 = ${Math.round(year).toLocaleString("en")} a year, against ${devices} × ${modality.perYear.toLocaleString("en")} a year per ${modality.label} scanner${u != null ? ` = ${pct(u)}` : ""}. Only these pathways' exams are counted.`,
      };
    }),
  };
}

/* ── Lifts (needs routes; used by the 3D view) ── */

export const DOOR_S = 20, STOREY_S = 8;
export const LOADING_S: Record<string, number> = { bed: 60, wheelchair: 30, foot: 15, supplies: 40, agv: 40 };

/** Seconds one trip occupies a car: doors and loading at both ends, there and back. */
export const roundTrip = (storeys: number, journey: string) => 2 * DOOR_S + 2 * (LOADING_S[journey] ?? 20) + 2 * storeys * STOREY_S;

export type LiftTrip = { lift: string; perDay: number; peakShare: number; storeys: number; journey: string };
export type LiftRow = { lift: string; cars: number; tripsPerDay: number; peakTrips: number; utilisation: number; flag: boolean; formula: string };

export function liftLoad(trips: LiftTrip[], cars: (lift: string) => number): LiftRow[] {
  const by = new Map<string, LiftTrip[]>();
  for (const t of trips) (by.get(t.lift) ?? by.set(t.lift, []).get(t.lift)!).push(t);
  return [...by.entries()].map(([lift, ts]) => {
    const c = Math.max(1, cars(lift));
    const peak = ts.reduce((s, t) => s + t.perDay * t.peakShare, 0);
    const busy = ts.reduce((s, t) => s + t.perDay * t.peakShare * roundTrip(t.storeys, t.journey), 0);
    const u = busy / (c * 3600);
    return {
      lift, cars: c, tripsPerDay: r1(ts.reduce((s, t) => s + t.perDay, 0)), peakTrips: r1(peak), utilisation: u, flag: u > LIFT_FLAG,
      formula: `${r1(peak)} trips in the busiest hour × round trip (doors ${DOOR_S} s and loading at each end, ${STOREY_S} s a storey each way) = ${Math.round(busy)} s, ÷ (${c} car${c === 1 ? "" : "s"} × 3600 s) = ${pct(u)}. Flag above ${pct(LIFT_FLAG)}; only these pathways' trips are counted.`,
    };
  }).sort((a, b) => b.utilisation - a.utilisation);
}

/* ── Corridor traffic (3D heat layer) ── */

/** Patients a day through each 2 m cell of corridor: walk legs sampled every metre, each cell counted once per leg. */
export function corridorHeat(legs: { floorId: number; points: [number, number][]; perDay: number }[], cell = 2): Map<string, { floorId: number; x: number; z: number; perDay: number }> {
  const out = new Map<string, { floorId: number; x: number; z: number; perDay: number }>();
  for (const leg of legs) {
    if (leg.perDay <= 0) continue;
    const seen = new Set<string>();
    for (let i = 1; i < leg.points.length; i++) {
      const [ax, az] = leg.points[i - 1], [bx, bz] = leg.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell), key = `${leg.floorId}:${cx}:${cz}`;
        if (seen.has(key)) continue; seen.add(key);
        const e = out.get(key) ?? out.set(key, { floorId: leg.floorId, x: (cx + 0.5) * cell, z: (cz + 0.5) * cell, perDay: 0 }).get(key)!;
        e.perDay += leg.perDay;
      }
    }
  }
  return out;
}

/* ── Clean and dirty routes (wave 12, A7) ── */

export type CdFlow = { name: string; kind: string; profile: number[] | null; legs: { floorId: number; points: [number, number][] }[]; lifts: string[] };
export type CdResult = {
  /** 2 m stretches of corridor that both clean and dirty flows walk (centres, metres). */
  shared: { floorId: number; x: number; z: number; clean: string[]; dirty: string[] }[];
  /** Lifts both use, and the hours of the day both are moving through them. */
  lifts: { name: string; clean: string[]; dirty: string[]; hours: number[] }[];
};

/**
 * Where clean supplies and dirty/waste flows meet: corridor cells both pass through, lifts both use, and the hours
 * both are active in a shared lift (a flow without an arrival profile counts as active all day).
 */
export function cleanDirtyConflicts(flows: CdFlow[], cell = 2): CdResult {
  const clean = flows.filter((f) => f.kind === "SUPPLIES"), dirty = flows.filter((f) => f.kind === "WASTE");
  const cellsOf = (f: CdFlow) => {
    const m = new Map<string, { floorId: number; x: number; z: number }>();
    for (const leg of f.legs) for (let i = 1; i < leg.points.length; i++) {
      const [ax, az] = leg.points[i - 1], [bx, bz] = leg.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2)));
      for (let t = 0; t <= n; t++) {
        const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n;
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell), k = `${leg.floorId}:${cx}:${cz}`;
        if (!m.has(k)) m.set(k, { floorId: leg.floorId, x: (cx + 0.5) * cell, z: (cz + 0.5) * cell });
      }
    }
    return m;
  };
  const cMaps = clean.map((f) => ({ f, m: cellsOf(f) })), dMaps = dirty.map((f) => ({ f, m: cellsOf(f) }));
  const shared = new Map<string, CdResult["shared"][number]>();
  for (const c of cMaps) for (const d of dMaps) for (const [k, v] of c.m) if (d.m.has(k)) {
    const s = shared.get(k) ?? { ...v, clean: [], dirty: [] };
    if (!s.clean.includes(c.f.name)) s.clean.push(c.f.name);
    if (!s.dirty.includes(d.f.name)) s.dirty.push(d.f.name);
    shared.set(k, s);
  }
  const active = (f: CdFlow, h: number) => !f.profile || f.profile.length !== 24 || f.profile[h] > 0;
  const liftNames = [...new Set(clean.flatMap((f) => f.lifts))].filter((n) => dirty.some((f) => f.lifts.includes(n)));
  const lifts = liftNames.map((name) => {
    const cs = clean.filter((f) => f.lifts.includes(name)), ds = dirty.filter((f) => f.lifts.includes(name));
    const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => cs.some((f) => active(f, h)) && ds.some((f) => active(f, h)));
    return { name, clean: cs.map((f) => f.name), dirty: ds.map((f) => f.name), hours };
  });
  return { shared: [...shared.values()], lifts };
}

/** Hours as ranges for reading: [7,8,9,13] → "07–10, 13–14". */
export function hourRanges(hours: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < hours.length; i++) {
    const a = hours[i]; let b = a;
    while (hours[i + 1] === b + 1) b = hours[++i];
    out.push(`${String(a).padStart(2, "0")}–${String(b + 1).padStart(2, "0")}`);
  }
  return out.join(", ");
}

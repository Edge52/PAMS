/**
 * The simulation model of a hospital (wave 14, B3): what each pathway step waits for, worked out the same way as the
 * pathway analysis (src/lib/flows/analysis.ts), so the two agree. Pure.
 *
 * - A stay of 12 hours or more waits for a bed of its department (beds registered, else beds of its rooms, else bed rooms).
 * - A step that needs a CT, MRI, X-ray or ultrasound scanner waits for one in its room, else in its department.
 * - Any other step with minutes waits for its room, or one of its department's care rooms.
 * - Moving a patient other than on foot needs a porter; a change of floor needs a lift car (bed lifts for beds and
 *   trolleys when the hospital has any).
 */
import { BED_STAY_MIN, placeOf, SCANNERS, type ADept, type AFlow } from "./analysis";
import { EVEN_PROFILE } from "./model";
import type { SimModel, SimResource, SimStep } from "./simulate";

export type MRoom = { id: number; name: string; type: string; departmentId: number | null; level: number; beds: number };
export type MAsset = { roomId: number | null; typeCode: string };
export type MLift = { kind: string; cars: number };
export type MFlow = AFlow & { kind: string };

/** Porters assumed on duty when nothing else is said (the page lets the planner change it). */
export const DEFAULT_PORTERS = 4;

export function buildSimModel(flows: MFlow[], rooms: MRoom[], depts: ADept[], assets: MAsset[], lifts: MLift[], porters = DEFAULT_PORTERS): { model: SimModel; skipped: string[] } {
  const resources = new Map<string, SimResource>();
  const skipped: string[] = [];
  const add = (r: SimResource) => { if (!resources.has(r.key)) resources.set(r.key, r); return r.key; };
  const levelOf = new Map(rooms.map((r) => [r.id, r.level]));
  const inRooms = (ids: number[], pred: (c: string) => boolean) => assets.filter((a) => a.roomId != null && ids.includes(a.roomId) && pred(a.typeCode)).length;
  const deptName = (id: number) => depts.find((d) => d.id === id)?.name ?? "Department";
  /** The floor most of a place's rooms are on. */
  const levelFor = (ids: number[]) => {
    const n = new Map<number, number>();
    for (const id of ids) { const l = levelOf.get(id); if (l != null) n.set(l, (n.get(l) ?? 0) + 1); }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };

  const simFlows = flows.filter((f) => {
    if (!f.dailyVolume) { skipped.push(`${f.name}: no patients a day set`); return false; }
    return true;
  }).map((f) => {
    const steps: SimStep[] = f.steps.map((s) => {
      const base = { key: s.key, label: s.label, kind: s.kind, minutes: s.minutes ?? 0 };
      if (s.kind !== "STEP") {
        const pl = placeOf(s, rooms, depts);
        return { ...base, minutes: 0, resource: null, level: pl ? levelFor(pl.roomIds.length ? pl.roomIds : rooms.filter((r) => r.departmentId === pl.departmentId).map((r) => r.id)) : null };
      }
      const pl = placeOf(s, rooms, depts);
      if (!pl) { if (s.minutes) skipped.push(`${f.name} › ${s.label}: no place, so no waiting`); return { ...base, resource: null, level: null }; }
      const deptRooms = pl.departmentId != null ? rooms.filter((r) => r.departmentId === pl.departmentId).map((r) => r.id) : pl.roomIds;
      const level = levelFor(pl.roomIds.length ? pl.roomIds : deptRooms);
      if ((s.minutes ?? 0) >= BED_STAY_MIN && pl.departmentId != null) {
        const ids = deptRooms;
        const devices = inRooms(ids, (c) => c.startsWith("FUR-BED"));
        const roomBeds = rooms.filter((r) => r.departmentId === pl.departmentId).reduce((t, r) => t + r.beds, 0);
        const bedRooms = rooms.filter((r) => r.departmentId === pl.departmentId && ["PATIENT_ROOM", "WARD", "ICU_BAY"].includes(r.type)).length;
        return { ...base, level, resource: add({ key: `bed:${pl.departmentId}`, label: `Beds, ${deptName(pl.departmentId)}`, kind: "bed", capacity: devices || roomBeds || bedRooms }) };
      }
      const scanner = SCANNERS.find((m) => s.equipment.some((c) => c === m.prefix || c.startsWith(`${m.prefix}-`)));
      if (scanner) {
        let n = inRooms(pl.roomIds, (c) => c.startsWith(scanner.prefix));
        if (!n && pl.departmentId != null) n = inRooms(deptRooms, (c) => c.startsWith(scanner.prefix));
        return { ...base, level, resource: add({ key: `scan:${pl.key}:${scanner.prefix}`, label: `${scanner.label} scanners, ${pl.label}`, kind: "scanner", capacity: n }) };
      }
      if (!s.minutes) return { ...base, resource: null, level };
      return { ...base, level, resource: add({ key: `room:${pl.key}`, label: pl.roomIds.length === 1 && pl.key.startsWith("r") ? pl.label : `Rooms, ${pl.label}`, kind: "room", capacity: pl.roomIds.length }) };
    });
    return {
      id: f.id, name: f.name, kind: f.kind, perDay: f.dailyVolume!, profile: f.arrivalProfile?.length === 24 ? f.arrivalProfile : EVEN_PROFILE,
      steps, links: f.links.map((l) => ({ from: l.fromKey, to: l.toKey, share: l.share, transport: l.transport, urgent: l.urgency === "URGENT" })),
    };
  });

  const bedCars = lifts.filter((l) => l.kind === "BED").reduce((t, l) => t + l.cars, 0);
  const allCars = lifts.filter((l) => l.kind !== "AGV").reduce((t, l) => t + l.cars, 0);
  const liftForBeds = bedCars ? add({ key: "lift:bed", label: "Bed lifts (cars)", kind: "lift", capacity: bedCars }) : null;
  const liftForAll = allCars ? add({ key: "lift:all", label: "Lifts, any (cars)", kind: "lift", capacity: allCars }) : null;
  const moved = simFlows.some((f) => f.kind === "PATIENT" && f.links.some((l) => l.transport !== "FOOT"));
  const porter = moved ? add({ key: "porter", label: "Porters on duty", kind: "porter", capacity: porters }) : null;
  return { model: { flows: simFlows, resources: [...resources.values()], liftForBeds, liftForAll, porter }, skipped };
}

/* ── Staff other than porters (wave 15) ── */

/** A group of staff on duty (radiographers, nurses, sonographers…) who work the rooms and scanners listed in `uses`. */
export type StaffGroup = { key: string; label: string; count: number; uses: string[] };
/** Kinds of resource a staff group can work: a bed stay doesn't hold a nurse for its whole length. */
export const STAFFED_KINDS = ["room", "scanner"] as const;

/**
 * The model with staff groups added: each group becomes a resource (kind "staff", capacity = staff on duty), and every
 * step that uses one of its rooms or scanners holds one of them too. A step takes the first group that lists its
 * resource. Groups with no name or nothing to work are left out.
 */
export function withStaff(model: SimModel, groups: StaffGroup[]): SimModel {
  const staffable = new Set(model.resources.filter((r) => (STAFFED_KINDS as readonly string[]).includes(r.kind)).map((r) => r.key));
  const used = groups.map((g, i) => ({ ...g, key: g.key || `staff:${i + 1}`, count: Math.max(0, Math.round(g.count)), uses: g.uses.filter((u) => staffable.has(u)) }))
    .filter((g) => g.label.trim() && g.uses.length);
  if (!used.length) return model;
  const groupOf = new Map<string, string>();
  for (const g of used) for (const u of g.uses) if (!groupOf.has(u)) groupOf.set(u, g.key);
  return {
    ...model,
    resources: [...model.resources, ...used.map((g): SimResource => ({ key: g.key, label: g.label.trim(), kind: "staff", capacity: g.count }))],
    flows: model.flows.map((f) => ({ ...f, steps: f.steps.map((s) => (s.kind === "STEP" && s.resource && groupOf.has(s.resource) ? { ...s, staff: groupOf.get(s.resource)! } : s)) })),
  };
}

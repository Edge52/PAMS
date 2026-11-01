/**
 * Update a hospital's drawings in place (wave 7, step 7-0). Pure.
 *
 * A revised building file (the CAD pipeline's output) is compared with what the hospital has, instead of deleting the
 * hospital and importing again, which would lose its equipment, history, lifts and anything else tied to rooms:
 * - floors match by level; rooms match by their code on that floor (the code is unique per floor);
 * - same code: name, outline (shape) and department are compared, and only what changed is updated;
 * - new code: the room is added;
 * - a code the new drawing no longer has: an empty room is removed; a room that still holds equipment is kept and
 *   listed, so its devices can be moved first;
 * - rooms drawn by hand in the app (rectangles without an outline) are never touched.
 * Nothing is written here: `planMerge` returns the list of changes for the review screen; applying is separate.
 */
import { polygonArea } from "../../components/assets/twin/geometry";
import { titleCase, type CadBuilding, type CadFloor, type CadRoom, type Pt } from "./cad-rooms";

export type ExistingFloor = { id: number; level: number; name: string };
export type ExistingRoom = { id: number; floorId: number; code: string; name: string; deptCode: string | null; poly: Pt[] | null; assets: number };

export type RoomChangeKind = "added" | "renamed" | "reshaped" | "department" | "removed" | "kept";
export type RoomChange = {
  kind: RoomChangeKind; floorLevel: number; floorName: string; code: string; name: string;
  /** Previous value for renamed / department changes. */
  was?: string; roomId?: number; assets?: number;
};
export type MergePlan = {
  floorsAdded: CadFloor[];
  floorsUpdated: { floorId: number; cad: CadFloor }[];
  /** Floors the hospital has that the new drawing doesn't (left as they are). */
  floorsMissing: ExistingFloor[];
  changes: RoomChange[];
  counts: Record<RoomChangeKind, number>;
  /** Drawing department codes not yet a department of the hospital (they're created). */
  newDepartments: string[];
};

/** Department codes are stored without punctuation ("M/S1" → "MS1"). */
export const deptKey = (code: string | null | undefined) => (code ? code.replace(/[^A-Z0-9]/gi, "").toUpperCase() || code.toUpperCase() : null);
/** Stairs and circulation keep no department. */
export const deptOf = (r: CadRoom) => (r.dept && r.dept !== "ST" ? r.dept : null);

/** Has the outline changed? Area by more than 2 %, or any corner moved by more than `tol` plan units. */
export function shapeChanged(a: Pt[] | null, b: Pt[], tol = 3): boolean {
  if (!a || a.length < 3) return true;
  const aa = polygonArea(a), ab = polygonArea(b);
  if (Math.abs(aa - ab) > Math.max(aa, ab) * 0.02) return true;
  if (a.length !== b.length) return true;
  // Same number of corners: each corner of b has a corner of a nearby.
  return b.some(([x, y]) => !a.some(([u, v]) => Math.hypot(u - x, v - y) <= tol));
}

export function planMerge(floors: ExistingFloor[], rooms: ExistingRoom[], b: CadBuilding, existingDeptCodes: string[]): MergePlan {
  const byLevel = new Map(floors.map((f) => [f.level, f]));
  const changes: RoomChange[] = [];
  const floorsAdded: CadFloor[] = [], floorsUpdated: { floorId: number; cad: CadFloor }[] = [];
  for (const cf of b.floors) {
    const ef = byLevel.get(cf.level);
    if (!ef) {
      floorsAdded.push(cf);
      for (const r of cf.rooms) changes.push({ kind: "added", floorLevel: cf.level, floorName: cf.name, code: r.code, name: titleCase(r.name) });
      continue;
    }
    floorsUpdated.push({ floorId: ef.id, cad: cf });
    const here = rooms.filter((r) => r.floorId === ef.id);
    const byCode = new Map(here.map((r) => [r.code.toUpperCase(), r]));
    const seen = new Set<number>();
    for (const r of cf.rooms) {
      const old = byCode.get(r.code.toUpperCase());
      const name = titleCase(r.name);
      if (!old) { changes.push({ kind: "added", floorLevel: cf.level, floorName: cf.name, code: r.code, name }); continue; }
      seen.add(old.id);
      const base = { floorLevel: cf.level, floorName: cf.name, code: r.code, name, roomId: old.id, assets: old.assets };
      if (old.name !== name) changes.push({ kind: "renamed", ...base, was: old.name });
      if (shapeChanged(old.poly, r.poly)) changes.push({ kind: "reshaped", ...base });
      if (deptKey(old.deptCode) !== deptKey(deptOf(r))) changes.push({ kind: "department", ...base, was: old.deptCode ?? "none" });
    }
    // Rooms the drawing no longer has. Hand-drawn rooms (no outline) belong to the app, not the drawing.
    for (const old of here) {
      if (seen.has(old.id) || !old.poly || old.poly.length < 3) continue;
      changes.push({ kind: old.assets > 0 ? "kept" : "removed", floorLevel: cf.level, floorName: cf.name, code: old.code, name: old.name, roomId: old.id, assets: old.assets });
    }
  }
  const drawn = new Set(b.floors.map((f) => f.level));
  const have = new Set(existingDeptCodes.map((c) => deptKey(c)));
  const newDepartments = [...new Set(b.floors.flatMap((f) => f.rooms.map(deptOf)).filter((d): d is string => !!d))].filter((d) => !have.has(deptKey(d)));
  const counts = { added: 0, renamed: 0, reshaped: 0, department: 0, removed: 0, kept: 0 } as Record<RoomChangeKind, number>;
  for (const c of changes) counts[c.kind]++;
  return { floorsAdded, floorsUpdated, floorsMissing: floors.filter((f) => !drawn.has(f.level)), changes, counts, newDepartments };
}

/** Light check that an uploaded file is a building file from the CAD pipeline; returns a reason when it isn't. */
export function checkBuilding(v: unknown): string | null {
  const b = v as Partial<CadBuilding> | null;
  if (!b || typeof b !== "object") return "That file isn't a building file.";
  if (!Array.isArray(b.floors) || !b.floors.length) return "The file has no floors.";
  if (typeof b.unitsPerMetre !== "number" || b.unitsPerMetre <= 0) return "The file doesn't say its scale (unitsPerMetre).";
  for (const f of b.floors) {
    if (typeof f?.level !== "number" || !Array.isArray(f.rooms) || !Array.isArray(f.walls)) return "A floor in the file is missing its level, rooms or walls.";
    for (const r of f.rooms) if (typeof r?.code !== "string" || !Array.isArray(r.poly) || r.poly.length < 3) return `Room ${r?.code ?? "?"} on level ${f.level} has no code or outline.`;
    const codes = f.rooms.map((r) => r.code.toUpperCase());
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) return `Room code ${dup} appears twice on level ${f.level}; room codes must be unique per floor.`;
  }
  return null;
}

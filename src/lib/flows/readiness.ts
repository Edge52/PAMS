/**
 * Equipment readiness of a patient pathway (wave 7, step 7c): for each step, are the device types it needs in its
 * room (or, failing that, its department), and is at least one of them working now? Pure; used by the pathway page
 * (server) and the 3D view's pathway card (live statuses, so a breakdown shows within one refresh).
 */
import type { Step } from "./model";

/** Statuses that count as "working now" (same as nearest working device in 3D). */
export const WORKING = new Set(["IN_SERVICE", "INSTALLED"]);

export type ReadyAsset = { id: number; typeCode: string; typeName: string; roomId: number | null; status: string };
export type ReadyRoom = { id: number; departmentId: number | null };

export type ReadinessRow = {
  stepKey: string; step: string; code: string; typeName: string;
  /** Where the devices were looked for: the step's room, else its department. */
  scope: "room" | "department";
  found: number; working: number;
  state: "ok" | "down" | "missing";
};
export type Readiness = { rows: ReadinessRow[]; noPlace: string[]; blocked: boolean; ok: number; total: number };

/** A code matches a device type exactly, or as its group ("LIF-VEN" matches "LIF-VEN-ICU"). */
const matches = (code: string, typeCode: string) => typeCode === code || typeCode.startsWith(`${code}-`);

export function readiness(steps: Step[], rooms: ReadyRoom[], assets: ReadyAsset[], statusOf: (a: ReadyAsset) => string = (a) => a.status, names: Record<string, string> = {}): Readiness {
  const rows: ReadinessRow[] = [], noPlace: string[] = [];
  const deptRooms = new Map<number, Set<number>>();
  for (const r of rooms) if (r.departmentId != null) (deptRooms.get(r.departmentId) ?? deptRooms.set(r.departmentId, new Set()).get(r.departmentId)!).add(r.id);
  for (const s of steps) {
    if (!s.equipment.length) continue;
    if (s.roomId == null && s.departmentId == null) { noPlace.push(s.label); continue; }
    for (const code of s.equipment) {
      const ofType = assets.filter((a) => a.roomId != null && matches(code, a.typeCode));
      let scope: ReadinessRow["scope"] = "room";
      let here = s.roomId != null ? ofType.filter((a) => a.roomId === s.roomId) : [];
      if (!here.length) {
        const dept = s.departmentId ?? rooms.find((r) => r.id === s.roomId)?.departmentId ?? null;
        const inDept = dept != null ? deptRooms.get(dept) : undefined;
        if (inDept) { here = ofType.filter((a) => inDept.has(a.roomId!)); scope = "department"; }
      }
      const working = here.filter((a) => WORKING.has(statusOf(a))).length;
      rows.push({
        stepKey: s.key, step: s.label, code, typeName: here[0]?.typeName ?? names[code] ?? ofType[0]?.typeName ?? code, scope,
        found: here.length, working, state: working ? "ok" : here.length ? "down" : "missing",
      });
    }
  }
  return { rows, noPlace, blocked: rows.some((r) => r.state !== "ok"), ok: rows.filter((r) => r.state === "ok").length, total: rows.length };
}

/** One line for a problem row ("CT scan: CT scanner out of service in the room"). */
export function readinessLine(r: ReadinessRow): string {
  const where = r.scope === "room" ? "in the room" : "in the department";
  if (r.state === "ok") return `${r.step}: ${r.working} working ${r.typeName} ${where}`;
  if (r.state === "down") return `${r.step}: ${r.typeName} ${where} ${r.found === 1 ? "is" : "are all"} out of action`;
  return `${r.step}: no ${r.typeName} ${where}`;
}

/**
 * Room standards in BOQ › Checks (wave 15, pure): the real rooms of the BOQ's linked departments checked against
 * the standard for their kind of room (area, ceiling, door, floor load, power, medical gas outlets, shielding and
 * services; see src/lib/assets/room-standards.ts), summed up per department.
 */
import type { CheckRow } from "@/lib/assets/room-standards";

export type StdRoom = {
  id: number; code: string; name: string; floor: string; facilityId: number;
  /** The BOQ department the room's real department is linked to. */
  boqDepartmentId: number;
  /** The standard it follows (null = no standard matches its name or type). */
  standard: string | null; rows: CheckRow[];
};
export type StdRoomIssue = { id: number; code: string; name: string; floor: string; facilityId: number; standard: string; short: string[]; unknown: string[] };
export type StdDepartment = {
  boqDepartmentId: number; department: string;
  rooms: number; withStandard: number; ok: number; short: number; unknown: number;
  /** Rooms below their standard on at least one measured item, worst first. */
  shortRooms: StdRoomIssue[];
  /** Rooms with nothing short but something not surveyed yet. */
  toSurvey: StdRoomIssue[];
  /** What is most often short or not surveyed across the department's rooms (label → rooms). */
  shortItems: { label: string; rooms: number }[]; unsurveyed: { label: string; rooms: number }[];
};

const issue = (r: StdRoom): StdRoomIssue => ({
  id: r.id, code: r.code, name: r.name, floor: r.floor, facilityId: r.facilityId, standard: r.standard ?? "",
  short: r.rows.filter((x) => x.state === "short").map((x) => x.label), unknown: r.rows.filter((x) => x.state === "unknown").map((x) => x.label),
});
const tally = (items: string[][]) => {
  const m = new Map<string, number>();
  for (const list of items) for (const l of new Set(list)) m.set(l, (m.get(l) ?? 0) + 1);
  return [...m.entries()].map(([label, rooms]) => ({ label, rooms })).sort((a, b) => b.rooms - a.rooms || a.label.localeCompare(b.label));
};

/** One summary per linked BOQ department, in the order given by `departments`; departments with no rooms are kept (rooms 0). */
export function summariseStandards(departments: { id: number; label: string }[], rooms: StdRoom[]): StdDepartment[] {
  return departments.map((d) => {
    const mine = rooms.filter((r) => r.boqDepartmentId === d.id);
    const withStd = mine.filter((r) => r.standard != null && r.rows.length > 0);
    const short = withStd.filter((r) => r.rows.some((x) => x.state === "short"));
    const unknown = withStd.filter((r) => !short.includes(r) && r.rows.some((x) => x.state === "unknown"));
    const shortRooms = short.map(issue).sort((a, b) => b.short.length - a.short.length || a.code.localeCompare(b.code));
    return {
      boqDepartmentId: d.id, department: d.label, rooms: mine.length, withStandard: withStd.length,
      ok: withStd.length - short.length - unknown.length, short: short.length, unknown: unknown.length,
      shortRooms, toSurvey: unknown.map(issue).sort((a, b) => a.code.localeCompare(b.code)),
      shortItems: tally(shortRooms.map((r) => r.short)), unsurveyed: tally(withStd.map((r) => r.rows.filter((x) => x.state === "unknown").map((x) => x.label))),
    };
  });
}

/** Totals over every department, for the panel's heading. */
export function standardsTotals(ds: StdDepartment[]) {
  return ds.reduce((t, d) => ({ rooms: t.rooms + d.rooms, withStandard: t.withStandard + d.withStandard, ok: t.ok + d.ok, short: t.short + d.short, unknown: t.unknown + d.unknown }),
    { rooms: 0, withStandard: 0, ok: 0, short: 0, unknown: 0 });
}

/**
 * Commissioning timeline (wave 14, plan item C5): for a new building or wing, which rooms are handed over by the
 * builder, have their equipment installed, and are accepted, week by week. Pure.
 *
 * - Planned: the room's handover date; installed and accepted targets are their own dates, or handover + the plan's
 *   weeks.
 * - Actual: handover as recorded; installed when the room is handed over and every device in it is installed (the
 *   latest date, not before the handover); accepted when every device has a signed acceptance. A room with no devices registered stays at "handed over"
 *   unless it is marked as needing no equipment, when it is complete at handover.
 */

export const STAGES = ["Not handed over", "Handed over", "Installed", "Accepted"] as const;
export type Stage = 0 | 1 | 2 | 3;
/** Stage colours, shared by the Gantt, the curve and the 3D view. */
export const STAGE_COLORS = ["#6b7280", "#d97706", "#2563eb", "#16a34a"] as const;
export const LATE_COLOR = "#dc2626";

export type CDevice = { deliveredOn: string | null; installedOn: string | null; acceptedOn: string | null };
export type CRoom = {
  roomId: number; code: string; name: string; floorId: number; floor: string; level: number; departmentId: number | null; department: string | null;
  handoverPlanned: string | null; installPlanned: string | null; acceptPlanned: string | null; handoverOn: string | null; noEquipment: boolean;
  devices: CDevice[];
};
export type CPlan = { startsOn: string; installWeeks: number; acceptWeeks: number };

const DAY = 86_400_000;
const toDay = (s: string) => Date.parse(`${s}T00:00:00Z`);
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => isoDay(toDay(s) + n * DAY);
/** The Monday on or before a date. */
export const weekStart = (s: string) => { const t = toDay(s); const dow = (new Date(t).getUTCDay() + 6) % 7; return isoDay(t - dow * DAY); };
const maxDay = (xs: (string | null)[]) => xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null);

export type Dates = { handover: string | null; installed: string | null; accepted: string | null };

export function plannedDates(r: CRoom, p: CPlan): Dates {
  const handover = r.handoverPlanned;
  const installed = r.installPlanned ?? (handover ? addDays(handover, r.noEquipment ? 0 : p.installWeeks * 7) : null);
  const accepted = r.acceptPlanned ?? (installed ? addDays(installed, r.noEquipment ? 0 : p.acceptWeeks * 7) : null);
  return { handover, installed, accepted };
}

export function actualDates(r: CRoom): Dates {
  const handover = r.handoverOn;
  if (r.noEquipment) return { handover, installed: handover, accepted: handover };
  // Installation is counted only once the room's handover is recorded: equipment registered earlier (or in a room
  // the builder hasn't handed over on paper) would otherwise show progress that hasn't happened in this plan.
  if (!r.devices.length || !handover) return { handover, installed: null, accepted: null };
  const allInstalled = r.devices.every((d) => d.installedOn);
  const allAccepted = r.devices.every((d) => d.acceptedOn);
  // Equipment counts as installed in the room no earlier than the room was handed over.
  const installed = allInstalled ? maxDay([handover, ...r.devices.map((d) => d.installedOn)]) : null;
  // A room can't be accepted before it is installed, nor installed before it is handed over (handover may be unrecorded).
  return { handover, installed, accepted: allAccepted && installed ? maxDay([installed, ...r.devices.map((d) => d.acceptedOn)]) : null };
}

/** The stage reached on a day: the furthest stage whose date has come. */
export function stageOn(d: Dates, day: string): Stage {
  if (d.accepted && d.accepted <= day) return 3;
  if (d.installed && d.installed <= day) return 2;
  if (d.handover && d.handover <= day) return 1;
  return 0;
}

export type RoomState = { room: CRoom; planned: Dates; actual: Dates; plannedStage: Stage; actualStage: Stage; late: boolean };

/** Every room's planned and actual stage on a day; late = behind the plan on a day not in the future. */
export function roomsOn(rooms: CRoom[], p: CPlan, day: string, today: string): RoomState[] {
  return rooms.map((room) => {
    const planned = plannedDates(room, p), actual = actualDates(room);
    const plannedStage = stageOn(planned, day), actualStage = stageOn(actual, day <= today ? day : today);
    return { room, planned, actual, plannedStage, actualStage, late: day <= today && actualStage < plannedStage };
  });
}

/** Week starts covering the plan: from its start to a week after the last planned or actual date. */
export function planWeeks(rooms: CRoom[], p: CPlan, today: string): string[] {
  const all = rooms.flatMap((r) => { const a = plannedDates(r, p), b = actualDates(r); return [a.handover, a.installed, a.accepted, b.handover, b.installed, b.accepted]; });
  const first = weekStart([p.startsOn, ...all.filter((x): x is string => !!x)].sort()[0]);
  const last = weekStart(maxDay([...all, p.startsOn, today < p.startsOn ? null : today]) ?? p.startsOn);
  const out: string[] = [];
  for (let w = first; w <= last && out.length < 260; w = addDays(w, 7)) out.push(w);
  out.push(addDays(out[out.length - 1], 7));
  return out;
}

export type CurvePoint = { week: string; planned: [number, number, number]; actual: [number, number, number] | null };

/** Rooms handed over, installed and accepted by the end of each week: planned, and actual up to today. */
export function curve(rooms: CRoom[], p: CPlan, weeks: string[], today: string): CurvePoint[] {
  const planned = rooms.map((r) => plannedDates(r, p)), actual = rooms.map(actualDates);
  const count = (ds: Dates[], day: string): [number, number, number] => {
    const s = ds.map((d) => stageOn(d, day));
    return [s.filter((x) => x >= 1).length, s.filter((x) => x >= 2).length, s.filter((x) => x >= 3).length];
  };
  return weeks.map((w) => { const end = addDays(w, 6); return { week: w, planned: count(planned, end), actual: w <= today ? count(actual, end < today ? end : today) : null }; });
}

/** Devices delivered, installed and accepted by a day (for the progress line). */
export function deviceCounts(rooms: CRoom[], day: string) {
  const ds = rooms.flatMap((r) => r.devices);
  return { total: ds.length, delivered: ds.filter((d) => d.deliveredOn && d.deliveredOn <= day).length, installed: ds.filter((d) => d.installedOn && d.installedOn <= day).length, accepted: ds.filter((d) => d.acceptedOn && d.acceptedOn <= day).length };
}

export type GanttRow = {
  key: string; label: string; floor: string; level: number; rooms: number;
  /** Planned span (first handover → last acceptance) and the actual one so far. */
  planned: { from: string | null; handover: string | null; installed: string | null; to: string | null };
  actual: { handover: string | null; installed: string | null; accepted: string | null; done: number; total: number };
  late: number;
};

/** One Gantt row per floor and department: planned windows and how far each has got. */
export function ganttRows(rooms: CRoom[], p: CPlan, today: string): GanttRow[] {
  const by = new Map<string, CRoom[]>();
  for (const r of rooms) { const k = `${r.level}|${r.floorId}|${r.departmentId ?? 0}`; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  const min = (xs: (string | null)[]) => xs.reduce<string | null>((m, x) => (x && (!m || x < m) ? x : m), null);
  const allOr = (xs: (string | null)[]) => (xs.every(Boolean) ? maxDay(xs) : null);
  return [...by.entries()].sort(([a], [b]) => { const [la, fa, da] = a.split("|").map(Number), [lb, fb, db] = b.split("|").map(Number); return la - lb || fa - fb || da - db; }).map(([key, rs]) => {
    const pl = rs.map((r) => plannedDates(r, p)), ac = rs.map(actualDates);
    const states = roomsOn(rs, p, today, today);
    return {
      key, label: rs[0].department ?? "No department", floor: rs[0].floor, level: rs[0].level, rooms: rs.length,
      planned: { from: min(pl.map((d) => d.handover)), handover: maxDay(pl.map((d) => d.handover)), installed: maxDay(pl.map((d) => d.installed)), to: maxDay(pl.map((d) => d.accepted)) },
      actual: { handover: allOr(ac.map((d) => d.handover)), installed: allOr(ac.map((d) => d.installed)), accepted: allOr(ac.map((d) => d.accepted)), done: states.filter((s) => s.actualStage === 3).length, total: rs.length },
      late: states.filter((s) => s.late).length,
    };
  });
}

/** Rooms that need no equipment by default when a plan is made (the planner can change each). */
export const NO_EQUIPMENT_TYPES = new Set(["CORRIDOR", "WAITING", "OFFICE", "STORE", "TECHNICAL"]);

/** A plan for the 3D time slider: each room's planned and actual [handover, installed, accepted] dates. */
export type CommissioningPayload = {
  id: number; name: string; facilityId: number; today: string; weeks: string[];
  rooms: [number, (string | null)[], (string | null)[]][];
};

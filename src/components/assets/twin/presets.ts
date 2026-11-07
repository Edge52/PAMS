/**
 * View presets (wave 16): one click shows a kind of service across the hospital — its rooms tinted, the rest dimmed,
 * the camera framed on them, with a summary of their equipment. Pure: which rooms belong to a preset and the summary.
 *
 * A room belongs when its department is of one of the preset's types (or its name says so), or the room itself is of
 * the preset's room type or name. Corridors, stairs, lifts and shafts never count.
 */
import { coreKind } from "./geometry";

export type PresetId = "imaging" | "icu";
export type Preset = {
  id: PresetId; label: string; color: string;
  /** Department type codes (seed-data/department-types.json). */
  deptTypes: string[];
  roomTypes: string[];
  /** Upper-cased room or department names that belong. */
  pattern: RegExp;
  /** Device category codes (or their prefixes) shown first in the summary. */
  devicePrefix: string[];
};

export const PRESETS: Preset[] = [
  {
    id: "imaging", label: "Imaging", color: "#b49bff", deptTypes: ["RAD", "CATH"], roomTypes: ["IMAGING_ROOM"],
    pattern: /\b(MRI|CT|X-?RAY|RADIOLOG\w*|IMAGING|MAMMO\w*|ULTRASOUND|U\/S|FLUORO\w*|ANGIO\w*|CATH LAB|DEXA|NUCLEAR|PET)\b/,
    devicePrefix: ["IMG"],
  },
  {
    id: "icu", label: "ICU", color: "#ff8a5c", deptTypes: ["ICU", "CCU", "NICU", "PICU"], roomTypes: ["ICU_BAY"],
    pattern: /\b(ICU|CCU|NICU|PICU|ITU|HDU|SCBU|INTENSIVE|CRITICAL CARE)\b/,
    devicePrefix: ["LIF", "MON", "INF"],
  },
];
export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!;

type R = { id: number; name: string; type: string; departmentId: number | null; floorId: number };
type D = { id: number; name: string; typeCode?: string | null };

/** The rooms of a preset. */
export function presetRooms(p: Preset, rooms: R[], depts: D[]): number[] {
  const deptIn = new Set(depts.filter((d) => (d.typeCode && p.deptTypes.includes(d.typeCode)) || p.pattern.test(d.name.toUpperCase())).map((d) => d.id));
  return rooms.filter((r) => r.type !== "CORRIDOR" && !coreKind(r.name)
    && ((r.departmentId != null && deptIn.has(r.departmentId)) || p.roomTypes.includes(r.type) || p.pattern.test(r.name.toUpperCase())))
    .map((r) => r.id);
}

type A = { id: number; roomId: number | null; status: string; categoryCode: string; category: string };
export type PresetSummary = {
  rooms: number; floors: number[]; devices: number;
  /** Devices by status, most first. */
  statuses: { status: string; n: number }[];
  /** Device categories, the preset's own first, then by count. */
  categories: { code: string; name: string; n: number }[];
  /** Rooms with a device out of service or under maintenance. */
  troubleRooms: number[];
};

export function presetSummary(p: Preset, roomIds: number[], rooms: R[], assets: A[], statusOf: (a: A) => string = (a) => a.status): PresetSummary {
  const ids = new Set(roomIds);
  const floors = [...new Set(rooms.filter((r) => ids.has(r.id)).map((r) => r.floorId))];
  const mine = assets.filter((a) => a.roomId != null && ids.has(a.roomId));
  const st = new Map<string, number>(), cat = new Map<string, { code: string; name: string; n: number }>(), trouble = new Set<number>();
  for (const a of mine) {
    const s = statusOf(a); st.set(s, (st.get(s) ?? 0) + 1);
    const c = cat.get(a.categoryCode) ?? { code: a.categoryCode, name: a.category, n: 0 }; c.n++; cat.set(a.categoryCode, c);
    if (s === "OUT_OF_SERVICE" || s === "UNDER_MAINTENANCE") trouble.add(a.roomId!);
  }
  const own = (code: string) => p.devicePrefix.some((x) => code === x || code.startsWith(`${x}-`));
  return {
    rooms: ids.size, floors, devices: mine.length,
    statuses: [...st].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    categories: [...cat.values()].sort((a, b) => Number(own(b.code)) - Number(own(a.code)) || b.n - a.n),
    troubleRooms: [...trouble],
  };
}

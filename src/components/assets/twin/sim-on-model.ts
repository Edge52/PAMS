/**
 * Queue simulation results on the model (wave 17, 3D roadmap phase 8): which rooms, scanners and lifts each
 * simulated resource stands for, and the colour of its load. Pure.
 */
import { CARE_ROOM_TYPES } from "../../../lib/flows/analysis";

export type SimPlaceRoom = { id: number; type: string; departmentId: number | null };
export type SimPlaceDevice = { id: number; roomId: number | null; typeCode: string };
export type SimPlace = { rooms: number[]; devices: number[]; lifts: "bed" | "all" | null };

const BED_TYPES = new Set(["PATIENT_ROOM", "WARD", "ICU_BAY"]);

/** Rooms of a place key from the model ("r12" = room 12, "d4" = department 4's care rooms). */
function placeRooms(key: string, rooms: SimPlaceRoom[]): number[] {
  if (key.startsWith("r")) { const id = Number(key.slice(1)); return rooms.some((r) => r.id === id) ? [id] : []; }
  if (key.startsWith("d")) { const d = Number(key.slice(1)); return rooms.filter((r) => r.departmentId === d && CARE_ROOM_TYPES.has(r.type)).map((r) => r.id); }
  return [];
}

/** Where a simulated resource is (see buildSimModel's keys): rooms to colour, scanners to light up, lifts to tint. */
export function simPlace(key: string, rooms: SimPlaceRoom[], devices: SimPlaceDevice[]): SimPlace {
  const none: SimPlace = { rooms: [], devices: [], lifts: null };
  if (key === "lift:bed") return { ...none, lifts: "bed" };
  if (key === "lift:all") return { ...none, lifts: "all" };
  if (key.startsWith("room:")) return { ...none, rooms: placeRooms(key.slice(5), rooms) };
  if (key.startsWith("bed:")) {
    const d = Number(key.slice(4)), mine = rooms.filter((r) => r.departmentId === d);
    const beds = mine.filter((r) => BED_TYPES.has(r.type));
    return { ...none, rooms: (beds.length ? beds : mine).map((r) => r.id) };
  }
  if (key.startsWith("scan:")) {
    const [, place, prefix] = key.split(":");
    const ids = new Set(placeRooms(place, rooms));
    if (!ids.size && place.startsWith("d")) { const d = Number(place.slice(1)); for (const r of rooms) if (r.departmentId === d) ids.add(r.id); }
    const scanners = devices.filter((x) => x.roomId != null && ids.has(x.roomId) && (x.typeCode === prefix || x.typeCode.startsWith(`${prefix}-`)));
    return { ...none, rooms: scanners.length ? [...new Set(scanners.map((x) => x.roomId!))] : [...ids], devices: scanners.map((x) => x.id) };
  }
  return none;
}

/** Load colour: green up to 60 %, yellow to 85 %, red above (the simulator's flag), grey when nothing ran. */
export function loadColor(utilisation: number | null | undefined): string {
  if (utilisation == null) return "#7c8c99";
  return utilisation > 0.85 ? "#ff5a6a" : utilisation > 0.6 ? "#ffd166" : "#3ddc97";
}

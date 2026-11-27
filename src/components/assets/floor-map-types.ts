/**
 * Floor map types and small helpers (split from floor-map.tsx in wave 41; no logic changes).
 */
import { fitLabel } from "@/lib/assets/visuals";
import type { MoveResult } from "@/lib/assets/mutations";

export type MapRoom = {
  id: number; code: string; name: string; type: string; beds: number; x: number; y: number; w: number; h: number;
  departmentId: number | null;
  /** Real outline from CAD (plan units); drawn instead of the rectangle when present. */
  polygon?: [number, number][] | null;
};
export type MapAsset = {
  id: number; tag: string; roomId: number; posX: number | null; posY: number | null; status: string; condition: string;
  criticality: string | null; manufacturer: string | null; model: string | null; serial: string | null; warrantyEnd: string | null;
  typeCode: string; typeName: string; categoryCode: string | null; categoryName: string | null;
};
export type MapDept = { id: number; code: string; name: string; nameAr: string | null; tint: string };
export type MapFloor = {
  id: number; name: string; level: number; planWidth: number; planHeight: number; planImageUrl: string | null;
  buildingName: string; facilityName: string;
};
export type MoveAction = (input: { assetId: number; toRoomId: number; posX: number | null; posY: number | null; reason: string | null }) => Promise<MoveResult>;

export type Selection = { kind: "room"; id: number } | { kind: "asset"; id: number } | null;
export type Drag = { assetId: number; x: number; y: number; targetRoomId: number | null };
export type PendingMove = { assetId: number; fromRoomId: number; toRoomId: number; posX: number | null; posY: number | null };
export type Filters = { q: string; category: string; type: string; status: string; criticality: string };
export const NO_FILTERS: Filters = { q: "", category: "", type: "", status: "", criticality: "" };
export const STATUSES = ["IN_SERVICE", "INSTALLED", "IN_STOCK", "UNDER_MAINTENANCE", "OUT_OF_SERVICE"];
export const CRITS = ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"];

export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
export function subscribeReducedMotion(cb: () => void) {
  const m = window.matchMedia(reducedMotionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function matchesFilters(a: MapAsset, f: Filters): boolean {
  if (f.category && a.categoryCode !== f.category) return false;
  if (f.type && a.typeCode !== f.type) return false;
  if (f.status && a.status !== f.status) return false;
  if (f.criticality && a.criticality !== f.criticality) return false;
  if (f.q) {
    const hay = `${a.tag} ${a.serial ?? ""} ${a.model ?? ""} ${a.manufacturer ?? ""} ${a.typeName} ${a.typeCode}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** Room name if it fits, else the short code ("BED03", "NS"), else a truncated name. */
export function roomLabel(r: { name: string; code: string; w: number }, fs: number): string {
  const full = fitLabel(r.name, r.w, fs);
  if (full === r.name) return full;
  const short = r.code.split("-").slice(-1)[0];
  return fitLabel(short, r.w, fs) === short ? short : full;
}

export const shortTag = (tag: string) => tag.split("-").slice(1).join("-") || tag;

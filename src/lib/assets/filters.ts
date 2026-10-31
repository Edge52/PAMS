/**
 * Asset register filter contract — parsing and serialising the URL params.
 * Cross-module contract (AGENTS.md): /assets?poId=&departmentId=&roomId=&deviceType=&status=
 * Pure: shared by the register page, the CSV export route and the label sheet.
 */

export const ASSET_STATUSES = ["IN_STOCK", "INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "DISPOSED"] as const;
export const ASSET_CONDITIONS = ["NEW", "GOOD", "FAIR", "POOR", "CONDEMNED"] as const;
export const CRITICALITIES = ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"] as const;
export const MAINTENANCE_TYPES = ["PPM", "CORRECTIVE", "CALIBRATION", "INSPECTION", "SAFETY_TEST"] as const;
export const MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"] as const;
export const ROOM_TYPES = [
  "PATIENT_ROOM", "WARD", "ICU_BAY", "OPERATING_ROOM", "PROCEDURE_ROOM", "IMAGING_ROOM",
  "LAB", "PHARMACY", "CONSULTATION", "NURSE_STATION", "STORE", "CORRIDOR", "WAITING", "OFFICE", "TECHNICAL", "OTHER",
] as const;
export const FACILITY_TYPES = [
  "GENERAL_HOSPITAL", "SPECIALIZED_HOSPITAL", "UNIVERSITY_HOSPITAL", "MEDICAL_CENTER", "CLINIC", "DIAGNOSTIC_CENTER",
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];
export type Criticality = (typeof CRITICALITIES)[number];
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];
export type RoomType = (typeof ROOM_TYPES)[number];
export type FacilityType = (typeof FACILITY_TYPES)[number];

export const SORTS = ["tag", "type", "location", "warranty", "status"] as const;
export type AssetSort = (typeof SORTS)[number];

export type AssetFilter = {
  q?: string;
  facilityId?: number;
  buildingId?: number;
  floorId?: number;
  departmentId?: number;
  roomId?: number;
  category?: string;
  deviceType?: string;
  status?: AssetStatus;
  criticality?: Criticality;
  warranty?: "expired" | "expiring";
  poId?: number;
  sort?: AssetSort;
  page?: number;
};

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(p: Params, k: string): string | undefined {
  const v = p instanceof URLSearchParams ? p.get(k) ?? undefined : p[k];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}
function id(p: Params, k: string): number | undefined {
  const v = get(p, k);
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 && n < 2 ** 31 ? n : undefined;
}
function oneOf<T extends string>(p: Params, k: string, list: readonly T[]): T | undefined {
  const v = get(p, k);
  return v && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseAssetFilter(p: Params): AssetFilter {
  const w = get(p, "warranty");
  const code = (k: string) => {
    const v = get(p, k)?.toUpperCase();
    return v && /^[A-Z0-9][A-Z0-9-]{0,47}$/.test(v) ? v : undefined;
  };
  const page = id(p, "page");
  return {
    q: get(p, "q")?.slice(0, 100),
    facilityId: id(p, "facilityId"),
    buildingId: id(p, "buildingId"),
    floorId: id(p, "floorId"),
    departmentId: id(p, "departmentId"),
    roomId: id(p, "roomId"),
    category: code("category"),
    deviceType: code("deviceType"),
    status: oneOf(p, "status", ASSET_STATUSES),
    criticality: oneOf(p, "criticality", CRITICALITIES),
    warranty: w === "expired" || w === "expiring" ? w : undefined,
    poId: id(p, "poId"),
    sort: oneOf(p, "sort", SORTS),
    page: page && page > 1 ? page : undefined,
  };
}

/** Back to a query string (without "?"), dropping empty values. `over` replaces/clears keys. */
export function filterToQuery(f: AssetFilter, over: Partial<Record<keyof AssetFilter, string | number | undefined | null>> = {}): string {
  const out = new URLSearchParams();
  const merged: Record<string, unknown> = { ...f, ...over };
  const order: (keyof AssetFilter)[] = ["q", "facilityId", "buildingId", "floorId", "departmentId", "roomId", "category", "deviceType",
    "status", "criticality", "warranty", "poId", "sort", "page"];
  for (const k of order) {
    const v = merged[k];
    if (v === undefined || v === null || v === "") continue;
    out.set(k, String(v));
  }
  return out.toString();
}

/** Number of user-visible filters in effect (ignores sort/page). */
export function activeFilterCount(f: AssetFilter): number {
  return (Object.keys(f) as (keyof AssetFilter)[]).filter((k) => k !== "sort" && k !== "page" && f[k] !== undefined).length;
}

/** Parse ids from ?ids=1,2,3 and/or repeated ?ids=1&ids=2. */
export function parseIds(v: string | string[] | undefined, max = 500): number[] {
  const parts = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(","));
  const out: number[] = [];
  for (const s of parts) {
    const n = Number(s.trim());
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

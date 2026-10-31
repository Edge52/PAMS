/** Data contract between the 3D view's server page and its client component. All plan coordinates are in floor plan units. */

export type TwinFloor = {
  id: number;
  name: string;
  level: number;
  buildingName: string;
  /** Metres above the building reference level. */
  elevation: number;
  planWidth: number;
  planHeight: number;
  /** Plan units per metre (10 for CAD imports; an estimate for hand-drawn plans). */
  unitsPerMetre: number;
  hasCad: boolean;
};

export type TwinRoom = {
  id: number;
  floorId: number;
  code: string;
  name: string;
  type: string;
  departmentId: number | null;
  /** Outline in plan units (polygon, or the rectangle turned into 4 points). */
  poly: [number, number][];
};

export type TwinDepartment = { id: number; name: string; code: string; color: string };

export type TwinAsset = {
  id: number;
  tag: string;
  deviceType: string;
  category: string;
  categoryCode: string;
  status: string;
  criticality: string | null;
  roomId: number | null;
  posX: number | null;
  posY: number | null;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
};

export type TwinData = {
  facility: { id: number; name: string; code: string };
  facilities: { id: number; name: string }[];
  floors: TwinFloor[];
  rooms: TwinRoom[];
  departments: TwinDepartment[];
  assets: TwinAsset[];
};

/** Linework of one CAD floor (flat segment arrays [x1, y1, x2, y2, …] in plan units). */
export type FloorGeometry = { walls: number[]; doors: number[]; glass: number[]; columns: number[] };

export const STATUS_COLORS: Record<string, string> = {
  IN_SERVICE: "#3cf5a6",
  INSTALLED: "#3cd6f5",
  IN_STOCK: "#8f9bff",
  UNDER_MAINTENANCE: "#ffb534",
  OUT_OF_SERVICE: "#ff4f62",
  DISPOSED: "#5d6b78",
};
export const STATUS_LABELS: Record<string, string> = {
  IN_SERVICE: "In service", INSTALLED: "Installed", IN_STOCK: "In stock",
  UNDER_MAINTENANCE: "Under maintenance", OUT_OF_SERVICE: "Out of service", DISPOSED: "Disposed",
};

/**
 * Live per-device metrics, sent as compact tuples (≈1,500 devices per hospital, refreshed every minute):
 * [assetId, status, openJobs, overduePpm 0|1, beyondLife 0|1, downtimeHours, valueEgp, recall 0|1]
 */
export type LiveRow = [number, string, number, 0 | 1, 0 | 1, number, number, 0 | 1];
export type LivePayload = { at: string; rows: LiveRow[] };

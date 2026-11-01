/**
 * Real-size equipment (wave 7): every device has a footprint and height in metres, so the 3D view, renders and
 * placement show it at its true size. Pure.
 *
 * The size comes from, in order: the asset itself (typed in at registration), its make and model (from the
 * datasheet), its device type, then a typical size for its equipment group below. Length is the long side of the
 * footprint, width the short side, height from the floor.
 */

export type Dims = { l: number; w: number; h: number };
export type DimsSource = "asset" | "model" | "type" | "typical";

/** Typical sizes by equipment group (level-2 code of the device taxonomy), metres, length × width × height. */
const TYPICAL: Record<string, [number, number, number]> = {
  "FUR-BED": [2.2, 1.0, 0.9], "FUR-CRT": [0.9, 0.55, 1.0], "FUR-EXM": [1.9, 0.7, 0.75], "FUR-MOR": [2.3, 0.9, 1.9], "FUR-TRN": [2.1, 0.75, 0.9],
  "LIF-VEN": [0.55, 0.55, 1.4], "LIF-ANE": [0.8, 0.7, 1.5], "LIF-DEF": [0.5, 0.45, 1.0], "LIF-NEO": [1.1, 0.65, 1.35], "LIF-AIR": [0.45, 0.35, 0.35],
  "LIF-EMS": [0.5, 0.4, 0.3], "LIF-RES": [0.5, 0.45, 1.2], "LIF-THM": [0.6, 0.5, 1.0],
  "MON-PAT": [0.45, 0.4, 1.5], "MON-VIT": [0.45, 0.4, 1.3], "MON-ECG": [0.5, 0.45, 1.0], "MON-HEM": [0.5, 0.45, 1.5], "MON-NEU": [0.6, 0.5, 1.4],
  "MON-OXI": [0.3, 0.25, 0.25], "MON-PUL": [0.3, 0.25, 0.25],
  "INF-PMP": [0.45, 0.45, 1.9], "INF-ACC": [0.3, 0.2, 0.3],
  "IMG-CT": [4.8, 2.3, 2.0], "IMG-MRI": [5.5, 2.4, 2.4], "IMG-XR": [2.4, 1.0, 2.2], "IMG-ANG": [4.0, 2.0, 2.5], "IMG-MAM": [1.2, 0.8, 2.0],
  "IMG-US": [0.9, 0.6, 1.5], "IMG-BMD": [2.6, 1.1, 1.3], "IMG-NM": [4.0, 2.0, 2.0], "IMG-DEN": [1.0, 1.0, 2.2], "IMG-ACC": [0.6, 0.6, 1.2],
  "IMG-PAC": [0.6, 0.4, 0.5], "IMG-RPR": [0.8, 0.6, 1.2],
  "RTH-EBT": [6.0, 4.0, 2.8], "RTH-SIM": [5.0, 2.3, 2.0], "RTH-BRA": [0.8, 0.6, 1.2], "RTH-DOS": [0.5, 0.5, 0.5],
  "SUR-OR": [2.1, 0.6, 0.95], "SUR-ROB": [1.5, 1.2, 1.9], "SUR-MIC": [1.2, 0.8, 1.9], "SUR-ENE": [0.5, 0.45, 1.1], "SUR-SUC": [0.5, 0.5, 1.0],
  "SUR-LAS": [0.6, 0.5, 1.1], "SUR-NEU": [1.0, 0.8, 1.8], "SUR-OPH": [1.0, 0.8, 1.6], "SUR-ORT": [0.6, 0.5, 1.0], "SUR-INS": [0.6, 0.4, 0.3],
  "STR-STE": [1.5, 1.0, 1.9], "STR-WSH": [1.0, 0.8, 1.9], "STR-CSS": [0.8, 0.6, 1.5], "STR-INF": [1.0, 0.8, 1.5], "STR-LTS": [0.6, 0.6, 0.6],
  "LAB-BGA": [0.5, 0.5, 0.5], "LAB-CHE": [1.6, 0.9, 1.3], "LAB-GEN": [0.7, 0.6, 0.6], "LAB-HEM": [0.9, 0.7, 0.7], "LAB-HIS": [1.0, 0.7, 1.2],
  "LAB-IMM": [1.4, 0.9, 1.3], "LAB-MIC": [0.9, 0.7, 0.8], "LAB-MOL": [0.8, 0.7, 0.7], "LAB-SAF": [1.5, 0.8, 2.1], "LAB-STO": [0.8, 0.8, 1.9],
  "PHA-CLD": [0.7, 0.7, 1.9], "PHA-AUT": [1.5, 1.0, 2.0],
  "BBK-STO": [0.8, 0.8, 1.9], "BBK-PRO": [0.8, 0.7, 1.0], "BBK-TST": [0.6, 0.5, 0.5],
  "THR-HD": [0.6, 0.55, 1.4], "THR-PD": [0.5, 0.5, 1.0], "THR-HBO": [3.0, 1.2, 1.6], "THR-LIT": [2.4, 1.0, 1.5], "THR-CRT": [0.5, 0.5, 1.0], "THR-DVT": [0.4, 0.3, 0.3],
  "DEN-UNT": [1.9, 0.8, 1.2], "DEN-EQP": [0.6, 0.5, 0.8], "DEN-DIG": [0.6, 0.5, 0.5],
  "CAR-CTH": [0.8, 0.6, 1.4], "CAR-STR": [2.0, 0.9, 1.4], "CAR-ECH": [0.8, 0.6, 1.5], "CAR-CVS": [0.6, 0.5, 1.2], "CAR-VAS": [0.6, 0.5, 1.2],
  "END-FLX": [0.7, 0.6, 1.6], "END-REP": [1.0, 0.7, 1.5], "END-RIG": [0.7, 0.6, 1.6],
  "ENT-CLN": [1.2, 0.8, 1.3], "ENT-AUD": [2.0, 2.0, 2.1],
  "OBG-DEL": [2.0, 1.0, 1.0], "OBG-FET": [0.5, 0.4, 1.3], "OBG-GYN": [1.8, 0.8, 1.1], "OBG-IVF": [1.2, 0.7, 1.5],
  "OPH-ANT": [1.0, 0.6, 1.4], "OPH-EXM": [1.0, 0.6, 1.4], "OPH-RET": [1.0, 0.6, 1.4],
  "REH-EXE": [1.8, 0.8, 1.3], "REH-MOB": [1.0, 0.7, 1.0], "REH-ELT": [0.6, 0.5, 1.0], "REH-THM": [0.6, 0.5, 1.0],
  "GAS-DIS": [0.4, 0.3, 0.3], "GAS-FLW": [0.3, 0.2, 0.3], "GAS-SRC": [2.0, 1.0, 1.8], "GAS-VAC": [1.2, 0.8, 1.4],
  "DRM-DX": [0.8, 0.6, 1.4], "DRM-LAS": [0.8, 0.6, 1.4],
  "BME-FLW": [0.5, 0.4, 0.4], "BME-RAD": [0.5, 0.4, 0.4], "BME-TST": [0.5, 0.4, 0.4],
};
const FALLBACK: [number, number, number] = [0.6, 0.5, 1.0];

/** Typical size for a device type from its code ("IMG-CT-128" → group "IMG-CT") or its group code. */
export function typicalDims(code: string | null | undefined): Dims {
  const c = (code ?? "").toUpperCase();
  const group = c.split("-").slice(0, 2).join("-");
  const [l, w, h] = TYPICAL[group] ?? FALLBACK;
  return { l, w, h };
}

type MaybeDims = { l?: number | null; w?: number | null; h?: number | null } | null | undefined;
const full = (d: MaybeDims): d is Dims => !!d && [d.l, d.w, d.h].every((v) => typeof v === "number" && v > 0);

/** The size to use and where it came from. A source counts only when all three measures are given. */
export function resolveDims(asset: MaybeDims, model: MaybeDims, type: MaybeDims, typeCode: string | null | undefined): { dims: Dims; source: DimsSource } {
  if (full(asset)) return { dims: norm(asset), source: "asset" };
  if (full(model)) return { dims: norm(model), source: "model" };
  if (full(type)) return { dims: norm(type), source: "type" };
  return { dims: typicalDims(typeCode), source: "typical" };
}

/** Length is the long side. */
function norm(d: Dims): Dims { return d.l >= d.w ? { l: d.l, w: d.w, h: d.h } : { l: d.w, w: d.l, h: d.h }; }

export const DIMS_SOURCE_LABELS: Record<DimsSource, string> = {
  asset: "entered for this device", model: "from its make and model", type: "from its device type", typical: "typical for its group",
};

export const formatDims = (d: Dims) => `${fmt(d.l)} × ${fmt(d.w)} × ${fmt(d.h)} m`;
const fmt = (v: number) => (Math.round(v * 100) / 100).toString();

/** Bounds a typed measure must fall in (metres). */
export const DIM_MIN = 0.05, DIM_MAX = 20;

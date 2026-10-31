/**
 * Problem layers for the 3D view: colour rooms (or whole departments) by a measure of trouble. Pure — no three.js,
 * unit-tested. Values come from per-device live metrics (see TwinLive); rooms with nothing to show stay neutral.
 */

export type LiveMetrics = {
  status: string;
  /** Open work orders on the device. */
  openJobs: number;
  /** A scheduled maintenance visit is past its date. */
  overduePpm: boolean;
  /** Older than its expected service life. */
  beyondLife: boolean;
  /** Hours out of use in the last 12 months. */
  downtimeHours: number;
  /** Purchase value in EGP (0 when unknown). */
  valueEgp: number;
  /** Device is on an open recall it hasn't been dealt with for. */
  recall: boolean;
};

export const LAYERS = ["department", "faults", "ppm", "life", "downtime", "value", "recalls"] as const;
export type LayerId = (typeof LAYERS)[number];

export const LAYER_INFO: Record<LayerId, { label: string; unit: (n: number) => string; help: string }> = {
  department: { label: "Departments", unit: () => "", help: "Rooms coloured by their department." },
  faults: { label: "Open faults", unit: (n) => `${n} open job${n === 1 ? "" : "s"}`, help: "Open work orders on the devices in each room." },
  ppm: { label: "Overdue maintenance", unit: (n) => `${n} overdue`, help: "Devices whose scheduled maintenance visit is past its date." },
  life: { label: "Past service life", unit: (n) => `${n} device${n === 1 ? "" : "s"}`, help: "Devices older than their expected service life." },
  downtime: { label: "Downtime (12 months)", unit: (n) => fmtHours(n), help: "Hours devices were out of use in the last 12 months." },
  value: { label: "Equipment value", unit: (n) => fmtEgp(n), help: "Purchase value of the equipment in each room (EGP)." },
  recalls: { label: "Open recalls", unit: (n) => `${n} device${n === 1 ? "" : "s"}`, help: "Devices on an open recall or safety notice." },
};

function fmtHours(h: number) { return h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`; }
function fmtEgp(v: number) {
  if (v >= 1e6) return `EGP ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `EGP ${Math.round(v / 1e3)}k`;
  return `EGP ${Math.round(v)}`;
}

/** The value one device adds to a layer. */
export function deviceValue(layer: LayerId, m: LiveMetrics): number {
  switch (layer) {
    case "faults": return m.openJobs;
    case "ppm": return m.overduePpm ? 1 : 0;
    case "life": return m.beyondLife ? 1 : 0;
    case "downtime": return m.downtimeHours;
    case "value": return m.valueEgp;
    case "recalls": return m.recall ? 1 : 0;
    default: return 0;
  }
}

export type Scope = "room" | "department";

/**
 * Value per room. With scope "department", every room of a department shows the department's total (rooms without a
 * department keep their own value), so the director sees which department is in trouble.
 */
export function roomValues(
  layer: LayerId, scope: Scope,
  rooms: { id: number; departmentId: number | null }[],
  devices: { roomId: number | null; metrics: LiveMetrics | undefined }[],
): Map<number, number> {
  const byRoom = new Map<number, number>();
  if (layer === "department") return byRoom;
  for (const d of devices) {
    if (d.roomId == null || !d.metrics || d.metrics.status === "DISPOSED") continue;
    const v = deviceValue(layer, d.metrics);
    if (v) byRoom.set(d.roomId, (byRoom.get(d.roomId) ?? 0) + v);
  }
  if (scope === "room") return byRoom;
  const byDept = new Map<number, number>();
  for (const r of rooms) if (r.departmentId != null) byDept.set(r.departmentId, (byDept.get(r.departmentId) ?? 0) + (byRoom.get(r.id) ?? 0));
  const out = new Map<number, number>();
  for (const r of rooms) {
    const v = r.departmentId != null ? byDept.get(r.departmentId) ?? 0 : byRoom.get(r.id) ?? 0;
    if (v) out.set(r.id, v);
  }
  return out;
}

/** Four warm steps from "a little" to "a lot" (bright on the dark 3D background). */
export const RAMP = ["#ffe066", "#ffa94d", "#ff6b4a", "#ff2d6f"] as const;
export const NEUTRAL = "#1c3346";

export type Legend = { breaks: number[]; colors: readonly string[]; labels: string[]; counts: number[] };

/**
 * Bucket thresholds. Counts use fixed steps (1, 2, 3–4, 5+) so "one open fault" always looks the same; continuous
 * measures (hours, money) use quartiles of the non-zero values so every map uses its whole ramp.
 */
export function legendFor(layer: LayerId, values: number[]): Legend | null {
  if (layer === "department") return null;
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
  const counts = layer === "faults" || layer === "ppm" || layer === "life" || layer === "recalls";
  let breaks: number[];
  if (counts) breaks = [1, 2, 3, 5];
  else if (!nz.length) breaks = [1, 2, 3, 4];
  else {
    const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * (nz.length - 1)))];
    breaks = [nz[0], q(0.25), q(0.5), q(0.75)];
    for (let i = 1; i < breaks.length; i++) if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] * 1.0001 + 1e-9;
  }
  const unit = LAYER_INFO[layer].unit;
  const labels = breaks.map((b, i) => {
    if (counts) return i === breaks.length - 1 ? `${b} or more` : breaks[i + 1] - b === 1 ? `${b}` : `${b}–${breaks[i + 1] - 1}`;
    const hi = breaks[i + 1];
    return hi == null ? `${unit(b)} or more` : `${unit(b)} – ${unit(hi)}`;
  });
  const out = [0, 0, 0, 0];
  for (const v of nz) out[bucketOf(v, breaks)]++;
  return { breaks, colors: RAMP, labels, counts: out };
}

export function bucketOf(v: number, breaks: number[]): number {
  let b = 0;
  for (let i = 0; i < breaks.length; i++) if (v >= breaks[i]) b = i;
  return b;
}

/** Colour for a room's value; null = leave the room neutral. */
export function colorFor(v: number | undefined, legend: Legend | null): string | null {
  if (!legend || !v || v <= 0) return null;
  return legend.colors[bucketOf(v, legend.breaks)];
}

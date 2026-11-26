/**
 * Analytics › Compare hospitals (wave 40): the same figures side by side, always per bed or per device so a large
 * hospital doesn't look worse for being large. A figure resting on fewer than MIN_N items is hidden (null). Pure.
 */
import { comparable, perUnit, type Kpi } from "./core";

export type HospitalIn = {
  id: number; name: string; beds: number;
  /** Devices in use (not disposed, not in stock). */
  devices: number;
  /** Planned maintenance visits due in the period and those done on time (within the grace days). */
  ppmDue: number; ppmOnTime: number;
  openJobs: number;
  /** Device hours down in the period, and device hours in the period (devices × hours). */
  downtimeHours: number; deviceHours: number;
  /** EGP, only for people who may see prices. */
  serviceCost?: number | null; acquisition?: number | null; pricedDevices?: number; spend?: number | null;
};

export type CompareMetric = "devices" | "perBed" | "ppm" | "openJobs" | "uptime" | "cosr" | "spendPerBed";

export const METRICS: { id: CompareMetric; label: string; unit: Kpi["unit"]; formula: string; prices?: boolean; higherIsBetter?: boolean }[] = [
  { id: "devices", label: "Devices", unit: "number", formula: "Devices in use (not disposed, not in stock)" },
  { id: "perBed", label: "Devices per bed", unit: "number", formula: "Devices in use ÷ beds" },
  { id: "ppm", label: "PPM on time", unit: "share", formula: "Planned visits done on time ÷ visits due in the period", higherIsBetter: true },
  { id: "openJobs", label: "Open jobs per 100 devices", unit: "number", formula: "Open work orders ÷ devices × 100", higherIsBetter: false },
  { id: "uptime", label: "Uptime", unit: "share", formula: "1 − device hours down ÷ device hours in the period", higherIsBetter: true },
  { id: "cosr", label: "COSR per year", unit: "share", formula: "Service cost ÷ purchase cost of the devices, scaled to a year", prices: true, higherIsBetter: false },
  { id: "spendPerBed", label: "Spend per bed", unit: "egp", formula: "Approved and paid invoices in the period ÷ beds", prices: true, higherIsBetter: false },
];

/** One hospital's figures as KPIs. `days` is the period length, for the yearly COSR. */
export function hospitalKpis(h: HospitalIn, days: number, showPrices: boolean): Record<CompareMetric, Kpi | null> {
  const m = (id: CompareMetric, value: number | null, n: number): Kpi | null => {
    const def = METRICS.find((x) => x.id === id)!;
    if (def.prices && !showPrices) return null;
    return { label: def.label, value: comparable(n) ? value : null, unit: def.unit, formula: def.formula, n };
  };
  const cosr = h.acquisition && h.acquisition > 0 && h.serviceCost != null ? (h.serviceCost / h.acquisition) * (365.25 / Math.max(1, days)) : null;
  return {
    devices: m("devices", h.devices, h.devices),
    perBed: m("perBed", perUnit(h.devices, h.beds), h.beds > 0 ? h.devices : 0),
    ppm: m("ppm", perUnit(h.ppmOnTime, h.ppmDue), h.ppmDue),
    openJobs: m("openJobs", perUnit(h.openJobs, h.devices, 100), h.devices),
    uptime: m("uptime", h.deviceHours > 0 ? Math.max(0, 1 - h.downtimeHours / h.deviceHours) : null, h.devices),
    cosr: m("cosr", cosr, h.pricedDevices ?? 0),
    spendPerBed: m("spendPerBed", h.spend != null ? perUnit(h.spend, h.beds) : null, h.beds),
  };
}

/** The best hospital per metric (only among shown values, and only when at least two hospitals have one). */
export function bestOf(rows: Record<CompareMetric, Kpi | null>[], metric: CompareMetric): number | null {
  const def = METRICS.find((x) => x.id === metric)!;
  if (def.higherIsBetter == null) return null;
  const vals = rows.map((r, i) => ({ i, v: r[metric]?.value })).filter((x): x is { i: number; v: number } => x.v != null);
  if (vals.length < 2) return null;
  vals.sort((a, b) => (def.higherIsBetter ? b.v - a.v : a.v - b.v));
  return vals[0].v === vals[1].v ? null : vals[0].i;
}

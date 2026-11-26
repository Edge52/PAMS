/**
 * Analytics › Lifecycle (wave 40): the replacement wave (devices due per budget year) and a capital what-if — the year
 * each device is replaced when spending is capped each year. Pure.
 *
 * Planner rules (`planCapital`):
 * - A device can be replaced from its due year plus `delayYears` (never before this year).
 * - Each year, devices that can be replaced queue by due year, then replacement score (highest first), then tag.
 *   The queue is funded in that order while the year's budget lasts; a later, cheaper device may fill what is left.
 * - Unused budget is not carried to the next year.
 * - A device costing more than a whole year's budget is never placed ("too costly for the cap").
 * - A device with no price is placed in its first year at no cost, and counted in `unpriced`.
 * - `budgetPerYear` null = no cap: every device is replaced in its first possible year.
 */

export type ScenarioSettings = { delayYears: number; budgetPerYear: number | null; includeTypes: string[] };

export const DEFAULT_SETTINGS: ScenarioSettings = { delayYears: 0, budgetPerYear: null, includeTypes: [] };
export const HORIZON_YEARS = 10;

/** Settings from a form or a stored jsonb value: delay 0–10 whole years, budget ≥ 0 or none, type codes. */
export function cleanSettings(v: unknown): ScenarioSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const d = Math.round(Number(o.delayYears));
  const b = o.budgetPerYear === null || o.budgetPerYear === "" || o.budgetPerYear === undefined ? null : Number(String(o.budgetPerYear).replace(/,/g, ""));
  const types = Array.isArray(o.includeTypes) ? o.includeTypes : typeof o.includeTypes === "string" ? o.includeTypes.split(",") : [];
  return {
    delayYears: Number.isFinite(d) ? Math.min(10, Math.max(0, d)) : 0,
    budgetPerYear: b != null && Number.isFinite(b) && b >= 0 ? Math.round(b) : null,
    includeTypes: [...new Set(types.map((t) => String(t).trim().toUpperCase()).filter((t) => /^[A-Z0-9-]{2,40}$/.test(t)))].slice(0, 50),
  };
}

export type PlanDevice = {
  id: number; tag: string; typeCode: string; typeName: string;
  /** Budget year it is due (from score, life and maker support). */
  dueYear: number;
  /** Replacement estimate, EGP; null = no price. */
  cost: number | null;
  score: number;
};

/** Does a type code match the chosen types? A chosen code matches itself and codes that start with it + "-". */
export function typeIncluded(code: string, include: string[]): boolean {
  if (!include.length) return true;
  const c = code.toUpperCase();
  return include.some((t) => c === t || c.startsWith(`${t}-`));
}

export type WaveYear = { year: number; devices: number; cost: number; unpriced: number };

/** Devices due per budget year over `years` years from `thisYear`; overdue devices count in this year. */
export function replacementWave(devices: PlanDevice[], thisYear: number, years = HORIZON_YEARS): WaveYear[] {
  const out = Array.from({ length: years }, (_, i): WaveYear => ({ year: thisYear + i, devices: 0, cost: 0, unpriced: 0 }));
  for (const d of devices) {
    const y = Math.max(thisYear, d.dueYear) - thisYear;
    if (y >= years) continue;
    out[y].devices++;
    if (d.cost == null) out[y].unpriced++; else out[y].cost += d.cost;
  }
  return out;
}

export type PlannedDevice = PlanDevice & { fromYear: number; replaceYear: number | null; waitYears: number | null; reason: "placed" | "too-costly" | "beyond-horizon" };
export type PlanYear = { year: number; budget: number | null; spent: number; replaced: number; unpriced: number; becameDue: number; backlog: number; backlogCost: number };
export type CapitalPlan = { years: PlanYear[]; devices: PlannedDevice[]; tooCostly: number; leftAtEnd: number; leftCostAtEnd: number };

export function planCapital(all: PlanDevice[], settings: ScenarioSettings, thisYear: number, years = HORIZON_YEARS): CapitalPlan {
  const s = cleanSettings(settings);
  const devices = all.filter((d) => typeIncluded(d.typeCode, s.includeTypes))
    .map((d): PlannedDevice => ({ ...d, fromYear: Math.max(thisYear, d.dueYear + s.delayYears), replaceYear: null, waitYears: null, reason: "beyond-horizon" }));
  const cap = s.budgetPerYear;
  for (const d of devices) if (cap != null && d.cost != null && d.cost > cap) d.reason = "too-costly";
  const order = (a: PlannedDevice, b: PlannedDevice) => a.fromYear - b.fromYear || b.score - a.score || a.tag.localeCompare(b.tag);
  const out: PlanYear[] = [];
  for (let i = 0; i < years; i++) {
    const year = thisYear + i;
    const queue = devices.filter((d) => d.replaceYear == null && d.fromYear <= year && d.reason !== "too-costly").sort(order);
    let left = cap ?? Infinity, spent = 0, replaced = 0, unpriced = 0;
    for (const d of queue) {
      const c = d.cost ?? 0;
      if (c > left) continue;
      left -= c; spent += c; replaced++; if (d.cost == null) unpriced++;
      d.replaceYear = year; d.waitYears = year - d.fromYear; d.reason = "placed";
    }
    const waiting = devices.filter((d) => d.replaceYear == null && d.fromYear <= year);
    out.push({
      year, budget: cap, spent, replaced, unpriced, becameDue: devices.filter((d) => d.fromYear === year).length,
      backlog: waiting.length, backlogCost: waiting.reduce((a, d) => a + (d.cost ?? 0), 0),
    });
  }
  const left = devices.filter((d) => d.replaceYear == null && d.fromYear < thisYear + years);
  return {
    years: out, devices: devices.sort((a, b) => (a.replaceYear ?? 9999) - (b.replaceYear ?? 9999) || order(a, b)),
    tooCostly: devices.filter((d) => d.reason === "too-costly").length, leftAtEnd: left.length, leftCostAtEnd: left.reduce((a, d) => a + (d.cost ?? 0), 0),
  };
}

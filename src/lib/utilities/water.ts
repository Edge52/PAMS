/**
 * Water quality (wave 41, GAHAR 2025 EFS.12; ECRI 2026 hazard 10, water for sterilisation). Pure rules: sampling
 * point kinds with their default limits, how a sample is judged (OK, action level, fail), what is due and the trend.
 * Tested in water.test.ts.
 *
 * Dialysis water limits are from ISO 23500 (total viable count limit 100 CFU/mL, action 50; endotoxin limit
 * 0.25 EU/mL, action 0.125; total chlorine 0.1 mg/L): check your edition. Drinking water: no coliforms in 100 mL and a
 * free chlorine residual of at least 0.2 mg/L (WHO guidance). Sterilizer (CSSD) feed water has no default: enter the
 * sterilizer maker's or AAMI ST108 limits on the point.
 */
import { addDays, testDue, type DueState } from "./utilities";

export const POINT_KINDS = ["DIALYSIS_RO", "DIALYSIS_LOOP", "DIALYSIS_MACHINE", "CSSD_FEED", "DRINKING_TANK", "OTHER"] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const isPointKind = (v: unknown): v is PointKind => typeof v === "string" && (POINT_KINDS as readonly string[]).includes(v);

export const POINT_LABELS: Record<PointKind, string> = {
  DIALYSIS_RO: "Dialysis: RO outlet", DIALYSIS_LOOP: "Dialysis: distribution loop", DIALYSIS_MACHINE: "Dialysis: machine",
  CSSD_FEED: "CSSD: sterilizer feed water", DRINKING_TANK: "Drinking water tank", OTHER: "Other",
};

export const ISO_23500_NOTE = "ISO 23500, check your edition";

export type Limits = {
  tvcAction: number | null; tvcLimit: number | null; endotoxinAction: number | null; endotoxinLimit: number | null;
  chlorineMax: number | null; freeChlorineMin: number | null; conductivityMax: number | null; coliformMax: number | null;
};
const NONE: Limits = { tvcAction: null, tvcLimit: null, endotoxinAction: null, endotoxinLimit: null, chlorineMax: null, freeChlorineMin: null, conductivityMax: null, coliformMax: null };
const DIALYSIS: Limits = { ...NONE, tvcAction: 50, tvcLimit: 100, endotoxinAction: 0.125, endotoxinLimit: 0.25, chlorineMax: 0.1 };

export function defaultLimits(kind: PointKind): Limits {
  if (kind === "DIALYSIS_RO" || kind === "DIALYSIS_LOOP" || kind === "DIALYSIS_MACHINE") return { ...DIALYSIS };
  if (kind === "DRINKING_TANK") return { ...NONE, coliformMax: 0, freeChlorineMin: 0.2 };
  return { ...NONE };
}

/** How often by default: dialysis monthly, drinking tanks every 3 months, CSSD monthly. */
export function defaultEvery(kind: PointKind): number {
  return kind === "DRINKING_TANK" ? 91 : 30;
}

export const isDialysis = (kind: string) => kind.startsWith("DIALYSIS_");

export type Values = { tvc?: number | null; endotoxin?: number | null; chlorine?: number | null; freeChlorine?: number | null; conductivity?: number | null; coliforms?: number | null; chemistryOk?: boolean | null };
export type Level = "OK" | "ACTION" | "FAIL";
export const LEVEL_LABELS: Record<Level, string> = { OK: "Within limits", ACTION: "Action level", FAIL: "Over the limit" };
export const LEVEL_TONE: Record<Level, "ok" | "warn" | "danger"> = { OK: "ok", ACTION: "warn", FAIL: "danger" };

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Judge one sample against the point's limits. At or over a limit fails; at or over an action level (and under the
 * limit) asks for action. `empty` = no result given at all (the form refuses it).
 */
export function judgeSample(l: Limits, v: Values): { level: Level; problems: string[]; empty: boolean } {
  const fails: string[] = [], actions: string[] = [];
  const empty = ![v.tvc, v.endotoxin, v.chlorine, v.freeChlorine, v.conductivity, v.coliforms].some(has) && v.chemistryOk == null;
  const upper = (val: number | null | undefined, action: number | null, limit: number | null, name: string, unit: string) => {
    if (!has(val)) return;
    if (limit != null && val >= limit) fails.push(`${name} ${fmt(val)} ${unit}: limit ${fmt(limit)}.`);
    else if (action != null && val >= action) actions.push(`${name} ${fmt(val)} ${unit}: action level ${fmt(action)}.`);
  };
  upper(v.tvc, l.tvcAction, l.tvcLimit, "Total viable count", "CFU/mL");
  upper(v.endotoxin, l.endotoxinAction, l.endotoxinLimit, "Endotoxin", "EU/mL");
  if (has(v.chlorine) && l.chlorineMax != null && v.chlorine > l.chlorineMax) fails.push(`Total chlorine ${fmt(v.chlorine)} mg/L: at most ${fmt(l.chlorineMax)}.`);
  if (has(v.conductivity) && l.conductivityMax != null && v.conductivity > l.conductivityMax) fails.push(`Conductivity ${fmt(v.conductivity)} µS/cm: at most ${fmt(l.conductivityMax)}.`);
  if (has(v.coliforms) && l.coliformMax != null && v.coliforms > l.coliformMax) fails.push(`Coliforms ${fmt(v.coliforms)} per 100 mL: at most ${fmt(l.coliformMax)}.`);
  if (has(v.freeChlorine) && l.freeChlorineMin != null && v.freeChlorine < l.freeChlorineMin) fails.push(`Free chlorine ${fmt(v.freeChlorine)} mg/L: at least ${fmt(l.freeChlorineMin)}.`);
  if (v.chemistryOk === false) fails.push("Chemical tests outside the limits (see the lab report).");
  return { level: fails.length ? "FAIL" : actions.length ? "ACTION" : "OK", problems: [...fails, ...actions], empty };
}

/** Sample due for a point. */
export function sampleDue(lastOn: string | null, everyDays: number, today: string): { state: DueState; dueOn: string | null; daysLate: number } {
  return testDue(lastOn, everyDays, today);
}

/** Next sample date after a failed or action-level result: ISO 23500 asks for a repeat after corrective action; we suggest a week. */
export function resampleBy(sampledOn: string, level: Level): string | null {
  return level === "OK" ? null : addDays(sampledOn, 7);
}

export type TrendPoint = { on: string; value: number; ok: boolean };

/** The trend of one measure at a point, oldest first, red when at or over the action level. */
export function trendOf(samples: { sampledOn: string; tvc: number | null; endotoxin: number | null }[], measure: "tvc" | "endotoxin", l: Limits): TrendPoint[] {
  const action = measure === "tvc" ? l.tvcAction ?? l.tvcLimit : l.endotoxinAction ?? l.endotoxinLimit;
  return samples.filter((s) => has(s[measure])).sort((a, b) => a.sampledOn.localeCompare(b.sampledOn))
    .map((s) => ({ on: s.sampledOn, value: s[measure] as number, ok: action == null || (s[measure] as number) < action }));
}

/** Work order title for a failed sample. */
export function sampleFailureTitle(point: string, problems: string[]): string {
  return `Water sample failed at ${point}${problems[0] ? `: ${problems[0]}` : ""}`.slice(0, 200);
}

/**
 * X-ray and CT tube life (wave 38, audit #17). Pure.
 *
 * The tube is the most expensive wearing part of a CT scanner or X-ray unit. Each tube is recorded with its serial,
 * the date it was fitted, its warranty (months and/or a counter figure, whichever comes first, as makers write it)
 * and its expected life. Counter readings from the service menu give the rate of use, and so the forecast date.
 *
 * Counter: CT service menus (GE, Siemens, Philips, Canon) all show the tube's scan seconds; most also show mAs and
 * rotations, and CT tube warranties are usually in scan seconds or months. General X-ray, mammography and
 * angiography units count exposures. So CT tubes default to scan seconds and the rest to exposures; any of the four
 * can be chosen per tube to match the warranty wording. Readings are the device's counter as shown on the screen;
 * use on this tube is the reading less the counter when the tube was fitted (0 when the counter resets with a new
 * tube).
 */
import { addDays, addMonths, daysBetween } from "./dates";
import { averageDailyUse, usagePoints, type MeterReading } from "./meters";

export const TUBE_COUNTERS = ["scan_seconds", "mas", "rotations", "exposures"] as const;
export type TubeCounter = (typeof TUBE_COUNTERS)[number];
export const TUBE_COUNTER_LABELS: Record<TubeCounter, string> = { scan_seconds: "Scan seconds", mas: "mAs", rotations: "Rotations", exposures: "Exposures" };
/** Warn this many weeks before the forecast replacement or the end of the warranty. */
export const TUBE_WARN_WEEKS = 8;

const under = (code: string, p: string) => code === p || code.startsWith(p + "-");
const NO_TUBE = new Set(["IMG-XR-CR", "IMG-MAM-ABUS"]);
/** Device types with an X-ray tube to track: CT, X-ray (incl. C-arm and fluoroscopy), mammography, angiography. */
export function isTubeType(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return !NO_TUBE.has(c) && ["IMG-CT", "IMG-XR", "IMG-MAM", "IMG-ANG"].some((p) => under(c, p));
}
export const defaultCounter = (code: string | null | undefined): TubeCounter => (code && under(code.toUpperCase(), "IMG-CT") ? "scan_seconds" : "exposures");

export type Tube = {
  installedOn: string; counterAtInstall: number; warrantyMonths: number | null; warrantyCounter: number | null; expectedLife: number | null;
  removedOn?: string | null;
};
export type TubeReading = { readOn: string; counter: number; id?: number };
export type TubeState = "removed" | "over_life" | "replace_soon" | "out_of_warranty" | "warranty_ending" | "ok" | "no_readings";
export type TubeForecast = {
  used: number; lastReading: TubeReading | null; perDay: number | null;
  /** Share of the expected life used (0–1+), null without an expected life. */
  lifeUsed: number | null;
  warrantyEnd: string | null; warrantyBy: "months" | "counter" | null;
  replaceBy: string | null;
  /** Warranty over (by date or counter), or ending within the warning weeks. */
  outOfWarranty: boolean; warrantyEnding: boolean;
  state: TubeState;
};

const byDate = (rs: TubeReading[]) => [...rs].sort((a, b) => a.readOn.localeCompare(b.readOn) || (a.id ?? 0) - (b.id ?? 0));

/** Why a counter reading can't be saved on this tube, or null. */
export function tubeReadingProblem(t: Tube, existing: TubeReading[], next: TubeReading, today: string): string | null {
  if (!Number.isFinite(next.counter) || next.counter < 0) return "Enter the counter as a number, 0 or more.";
  if (next.readOn > today) return "The reading date can't be in the future.";
  if (next.readOn < t.installedOn) return "The reading is dated before this tube was fitted.";
  if (t.removedOn && next.readOn > t.removedOn) return "This tube was removed before that date.";
  if (next.counter < t.counterAtInstall) return `The counter was ${t.counterAtInstall} when this tube was fitted; a reading can't be lower.`;
  const s = byDate(existing);
  const before = [...s].reverse().find((r) => r.readOn <= next.readOn), after = s.find((r) => r.readOn > next.readOn);
  if (before && next.counter < before.counter) return `The counter read ${before.counter} on ${before.readOn}. It can't go backwards.`;
  if (after && after.counter < next.counter) return `A later reading (${after.counter} on ${after.readOn}) is lower than this one. Check the date and the figure.`;
  return null;
}

/** The date use on the tube reaches `target` (counter units since fitting), from the readings, or forecast. */
function dateAt(points: { date: string; total: number }[], target: number, perDay: number | null): string | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.total >= target) {
      const span = daysBetween(a.date, b.date), gain = b.total - a.total;
      return gain > 0 && span > 0 ? addDays(a.date, Math.max(0, Math.ceil(((target - a.total) / gain) * span))) : b.date;
    }
  }
  const last = points.at(-1);
  if (!last || !perDay || perDay <= 0) return null;
  return addDays(last.date, Math.ceil((target - last.total) / perDay));
}

export function tubeForecast(t: Tube, readings: TubeReading[], today: string, warnWeeks = TUBE_WARN_WEEKS): TubeForecast {
  const s = byDate(readings);
  const meter: MeterReading[] = [{ readOn: t.installedOn, reading: t.counterAtInstall, kind: "READING" }, ...s.map((r) => ({ readOn: r.readOn, reading: r.counter, kind: "READING" as const }))];
  const points = usagePoints(meter);
  const last = s.at(-1) ?? null;
  const used = last ? Math.max(0, last.counter - t.counterAtInstall) : 0;
  const perDay = last ? averageDailyUse(points) : null;
  const byMonths = t.warrantyMonths ? addMonths(t.installedOn, t.warrantyMonths) : null;
  const byCounter = t.warrantyCounter ? dateAt(points, t.warrantyCounter, perDay) : null;
  const warrantyEnd = byMonths && byCounter ? (byMonths <= byCounter ? byMonths : byCounter) : byMonths ?? byCounter;
  const warrantyBy = !warrantyEnd ? null : warrantyEnd === byMonths ? "months" : "counter";
  const replaceBy = t.expectedLife ? dateAt(points, t.expectedLife, perDay) : null;
  const lifeUsed = t.expectedLife ? used / t.expectedLife : null;
  const soon = addDays(today, warnWeeks * 7);
  const hasWarranty = t.warrantyMonths != null || t.warrantyCounter != null;
  const outOfWarranty = hasWarranty && ((warrantyEnd != null && warrantyEnd < today) || (t.warrantyCounter != null && used >= t.warrantyCounter));
  const warrantyEnding = !outOfWarranty && warrantyEnd != null && warrantyEnd <= soon;
  let state: TubeState;
  if (t.removedOn) state = "removed";
  else if (lifeUsed != null && lifeUsed >= 1) state = "over_life";
  else if (replaceBy && replaceBy <= soon) state = "replace_soon";
  else if (outOfWarranty) state = "out_of_warranty";
  else if (warrantyEnding) state = "warranty_ending";
  else if (!last) state = "no_readings";
  else state = "ok";
  return { used, lastReading: last, perDay, lifeUsed, warrantyEnd, warrantyBy, replaceBy, outOfWarranty: !t.removedOn && outOfWarranty, warrantyEnding: !t.removedOn && warrantyEnding, state };
}

export const TUBE_STATE_LABELS: Record<TubeState, string> = {
  removed: "Removed", over_life: "Past expected life", replace_soon: `Replace within ${TUBE_WARN_WEEKS} weeks`, out_of_warranty: "Out of warranty",
  warranty_ending: `Warranty ends within ${TUBE_WARN_WEEKS} weeks`, ok: "In use", no_readings: "No readings",
};
export const TUBE_STATE_TONE = { removed: "neutral", over_life: "danger", replace_soon: "warn", out_of_warranty: "neutral", warranty_ending: "warn", ok: "ok", no_readings: "neutral" } as const;

/** Days the tube was in use (fitted to removed, or to today). */
export const tubeDays = (t: Pick<Tube, "installedOn" | "removedOn">, today: string) => Math.max(0, daysBetween(t.installedOn, t.removedOn ?? today));

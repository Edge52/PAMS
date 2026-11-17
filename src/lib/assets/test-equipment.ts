/**
 * Test equipment used on a maintenance visit (wave 27). Pure. Same rule as the electrical safety test's analyser
 * (`analyserProblem`, wave 23): an instrument whose calibration has run out on the day of the work can't be used to
 * sign the visit off.
 */
import { analyserProblem } from "./safety-tests";

export type Instrument = { id: number; tag: string; manufacturer?: string | null; model?: string | null; serial?: string | null; calibrationDue?: string | null };

/** "Fluke Biomedical ESA615, serial 123 (DGH-BME-900001)" */
export function instrumentLabel(i: Instrument): string {
  const name = [i.manufacturer, i.model].filter(Boolean).join(" ") || i.tag;
  return `${name}${i.serial ? `, serial ${i.serial}` : ""} (${i.tag})`;
}

/** Ids from a form (checkboxes `testEquipmentIds`): positive whole numbers, no repeats, at most 10. */
export function parseInstrumentIds(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const n = Number(typeof v === "string" ? v.trim() : v);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 10);
}

/**
 * Why the chosen instruments can't be used for work done on `on`, or null. `found` is what the database returned for
 * the chosen ids (test equipment of the same hospital); an id missing from it was not valid.
 */
export function instrumentsProblem(chosen: number[], found: Instrument[], on: string): string | null {
  if (chosen.some((id) => !found.some((f) => f.id === id))) return "Choose test equipment from this hospital's list.";
  const problems = found.map((f) => analyserProblem({ label: instrumentLabel(f), calibrationDue: f.calibrationDue }, on)).filter((p): p is string => !!p);
  if (!problems.length) return null;
  return `${problems.join(" ")} The visit can't be signed off with it: choose another instrument, or recalibrate it first.`;
}

/** Calibration state for the picker. */
export function calibrationState(due: string | null | undefined, today: string): "ok" | "expired" | "none" {
  if (!due) return "none";
  return due < today ? "expired" : "ok";
}

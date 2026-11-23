/**
 * MRI helium and cryogen log (wave 38, audit #14). Pure.
 *
 * A superconducting MRI magnet sits in liquid helium. The cold head and its compressor recondense the boil-off; when
 * either stops, or the water chiller that cools the compressor fails, helium is lost and the magnet can quench. The
 * biomedical team reads the level (and pressure, cold-head and compressor state, chiller water temperature) from the
 * service screen or the magnet monitor, daily or weekly.
 *
 * Warnings (defaults per magnet, settable):
 * - level below the minimum (70 %; makers usually ask for a refill around 60–70 %),
 * - level falling faster than allowed (more than 2 points in 30 days; a healthy zero-boil-off magnet loses almost
 *   nothing), counted from the last refill only,
 * - no reading for too long (7 days),
 * - cold head stopped or compressor stopped or faulty at the last reading.
 * Open MRIs with permanent or resistive magnets have no helium: their magnet is set "not cryogenic" and skipped.
 */
import { addDays, daysBetween } from "./dates";

export const CRYO_DEFAULTS = { heliumMinPct: 70, maxDropPct: 2, dropWindowDays: 30, maxGapDays: 7 } as const;
/** A rise of more than this many points between readings is a refill: the drop is counted from after it. */
export const REFILL_RISE = 1;

export const COLD_HEAD_STATES = ["RUNNING", "STOPPED"] as const;
export const COMPRESSOR_STATES = ["RUNNING", "STOPPED", "FAULT"] as const;
export const RUN_LABELS: Record<string, string> = { RUNNING: "Running", STOPPED: "Stopped", FAULT: "Fault" };

export type MagnetSettings = { cryogenic: boolean; heliumMinPct: number; maxDropPct: number; dropWindowDays: number; maxGapDays: number };
export type CryoReading = {
  id?: number; readOn: string; heliumPct: number; pressurePsi?: number | null;
  coldHead?: string | null; compressor?: string | null; chillerTempC?: number | null;
};
export type CryoWarningKind = "low" | "falling" | "missing" | "cold_head" | "compressor";
export type CryoWarning = { kind: CryoWarningKind; text: string };
export type CryoStatus = {
  latest: CryoReading | null;
  warnings: CryoWarning[];
  /** Points lost per 30 days since the last refill (null without two readings a day apart). */
  ratePer30: number | null;
  /** Drop inside the rate window since the last refill. */
  drop: number | null;
  /** The date the level reaches the minimum at the current rate (null when not falling). */
  reachesMinOn: string | null;
  daysSinceReading: number | null;
};

/** No row = cryogenic with the defaults; open MRI types (permanent magnets) default to not cryogenic. */
export function magnetSettings(row: Partial<MagnetSettings> | null | undefined, typeCode?: string | null): MagnetSettings {
  const open = !!typeCode && /^IMG-MRI-(OPEN|EXT)/.test(typeCode.toUpperCase());
  return {
    cryogenic: row?.cryogenic ?? !open,
    heliumMinPct: row?.heliumMinPct ?? CRYO_DEFAULTS.heliumMinPct,
    maxDropPct: row?.maxDropPct ?? CRYO_DEFAULTS.maxDropPct,
    dropWindowDays: row?.dropWindowDays ?? CRYO_DEFAULTS.dropWindowDays,
    maxGapDays: row?.maxGapDays ?? CRYO_DEFAULTS.maxGapDays,
  };
}

/** Is this an MRI device type (any field strength)? */
export const isMriType = (code: string | null | undefined) => !!code && /^IMG-MRI(-|$)/.test(code.toUpperCase());

const byDate = (rs: CryoReading[]) => [...rs].sort((a, b) => a.readOn.localeCompare(b.readOn) || (a.id ?? 0) - (b.id ?? 0));

/** Readings since the last refill (a rise of more than REFILL_RISE points), oldest first. */
export function sinceRefill(readings: CryoReading[]): CryoReading[] {
  const s = byDate(readings);
  let start = 0;
  for (let i = 1; i < s.length; i++) if (s[i].heliumPct - s[i - 1].heliumPct > REFILL_RISE) start = i;
  return s.slice(start);
}

/** Why a reading can't be saved, or null. */
export function cryoReadingProblem(r: CryoReading, today: string): string | null {
  if (!(r.heliumPct >= 0 && r.heliumPct <= 100)) return "Helium level must be between 0 and 100 %.";
  if (r.readOn > today) return "The reading date can't be in the future.";
  if (r.pressurePsi != null && !(r.pressurePsi >= -15 && r.pressurePsi <= 100)) return "Pressure must be between -15 and 100 psi.";
  if (r.chillerTempC != null && !(r.chillerTempC >= -20 && r.chillerTempC <= 60)) return "Chiller water temperature must be between -20 and 60 °C.";
  return null;
}

const pts = (n: number) => `${n.toFixed(1)} point${Math.abs(n - 1) < 1e-9 ? "" : "s"}`;

export function cryoStatus(readings: CryoReading[], s: MagnetSettings, today: string): CryoStatus {
  const sorted = byDate(readings);
  const latest = sorted.at(-1) ?? null;
  const base: CryoStatus = { latest, warnings: [], ratePer30: null, drop: null, reachesMinOn: null, daysSinceReading: latest ? daysBetween(latest.readOn, today) : null };
  if (!s.cryogenic) return base;
  const w: CryoWarning[] = [];
  if (!latest) {
    w.push({ kind: "missing", text: "No helium reading recorded yet." });
    return { ...base, warnings: w };
  }
  if (base.daysSinceReading! > s.maxGapDays) w.push({ kind: "missing", text: `No reading for ${base.daysSinceReading} days (the log expects one at least every ${s.maxGapDays} days).` });
  if (latest.heliumPct < s.heliumMinPct) w.push({ kind: "low", text: `Helium at ${latest.heliumPct} %, below the minimum of ${s.heliumMinPct} %. Book a refill.` });
  if (latest.coldHead === "STOPPED") w.push({ kind: "cold_head", text: "The cold head was stopped at the last reading: helium boils off. Call the service engineer." });
  if (latest.compressor === "STOPPED" || latest.compressor === "FAULT") {
    w.push({ kind: "compressor", text: `The helium compressor was ${latest.compressor === "FAULT" ? "in fault" : "stopped"} at the last reading. Check the chiller water and call the service engineer.` });
  }
  // Fall since the last refill: inside the window, and the long-run rate for the forecast.
  const seg = sinceRefill(sorted);
  let drop: number | null = null, ratePer30: number | null = null, reachesMinOn: string | null = null;
  if (seg.length >= 2) {
    // The level at the start of the window, by straight line between the readings around it (or the first reading
    // after the refill when that is later).
    const from = addDays(latest.readOn, -s.dropWindowDays);
    let startDate = seg[0].readOn, startLevel = seg[0].heliumPct;
    if (seg[0].readOn < from) {
      const i = seg.findIndex((r) => r.readOn >= from);
      const a = seg[i - 1], b = seg[i];
      const gap = daysBetween(a.readOn, b.readOn);
      startDate = from;
      startLevel = gap > 0 ? a.heliumPct + ((b.heliumPct - a.heliumPct) * daysBetween(a.readOn, from)) / gap : b.heliumPct;
    }
    const span = daysBetween(startDate, latest.readOn);
    if (span >= 1) {
      drop = Math.round((startLevel - latest.heliumPct) * 10) / 10;
      if (drop > s.maxDropPct) w.push({ kind: "falling", text: `Helium fell ${pts(drop)} in ${span} days (allowed: ${s.maxDropPct} in ${s.dropWindowDays} days). Look for a cold-head or compressor problem.` });
    }
    const all = daysBetween(seg[0].readOn, latest.readOn);
    if (all >= 1) {
      const perDay = (seg[0].heliumPct - latest.heliumPct) / all;
      ratePer30 = perDay * 30;
      if (perDay > 0 && latest.heliumPct > s.heliumMinPct) reachesMinOn = addDays(latest.readOn, Math.ceil((latest.heliumPct - s.heliumMinPct) / perDay));
    }
  }
  return { ...base, warnings: w, drop, ratePer30, reachesMinOn };
}

export const CRYO_WARNING_LABELS: Record<CryoWarningKind, string> = {
  low: "Helium low", falling: "Falling fast", missing: "Reading missing", cold_head: "Cold head stopped", compressor: "Compressor",
};

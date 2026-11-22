/**
 * Radiation safety records for imaging (wave 37): which device types use ionising radiation, ENRRA licence expiry,
 * physicist QC and protective equipment due dates, dosimetry flags and the status of a room. Pure.
 *
 * ENRRA is the Egyptian Nuclear and Radiological Regulatory Authority. The figures here are the usual ones (ICRP 103
 * occupational limit 20 mSv a year); the hospital's radiation protection officer should confirm them against the
 * licence conditions.
 */
import { addDays, addMonths, daysBetween } from "./dates";

/**
 * Device taxonomy codes (and their children) that use ionising radiation: X-ray, CT, C-arm and fluoroscopy,
 * mammography, angiography, nuclear medicine, DXA, dental X-ray and radiotherapy. MRI and ultrasound are not here.
 */
export const RADIATION_PREFIXES = ["IMG-CT", "IMG-XR", "IMG-MAM", "IMG-ANG", "IMG-NM", "IMG-BMD-DXA", "IMG-DEN", "RTH"] as const;
/** Inside those groups, types that emit nothing themselves (ultrasound breast scanner, dental sensors, software). */
export const NOT_RADIATION = new Set(["IMG-MAM-ABUS", "IMG-DEN-SENS", "IMG-DEN-PSP", "RTH-SIM-OIS"]);

const under = (code: string, prefix: string) => code === prefix || code.startsWith(prefix + "-");

/** Does this device type use ionising radiation? Pass the type's code. */
export function isRadiationType(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  if (NOT_RADIATION.has(c)) return false;
  return RADIATION_PREFIXES.some((p) => under(c, p));
}

/** SQL LIKE patterns for the same set (for queries): `code like ANY(...)`, minus NOT_RADIATION. */
export function radiationCodePatterns(): string[] {
  return RADIATION_PREFIXES.flatMap((p) => [p, `${p}-%`]);
}

/** Licences: renewal takes time, so warn 90 days ahead. QC tests and protective checks: 30 days. */
export const LICENCE_WARN_DAYS = 90;
export const CHECK_WARN_DAYS = 30;

export type ExpiryState = "expired" | "expiring" | "ok";
export function licenceState(expiresOn: string, today: string, warnDays = LICENCE_WARN_DAYS): ExpiryState {
  if (expiresOn < today) return "expired";
  return daysBetween(today, expiresOn) <= warnDays ? "expiring" : "ok";
}
export const LICENCE_STATE_LABELS: Record<ExpiryState, string> = { expired: "Expired", expiring: `Expires within ${LICENCE_WARN_DAYS} days`, ok: "Valid" };

export type CheckState = "failed" | "overdue" | "soon" | "ok" | "none";
/** A QC test or protective equipment check, from its latest record. */
export function checkState(last: { result: string; nextDue: string | null } | null | undefined, today: string, warnDays = CHECK_WARN_DAYS): CheckState {
  if (!last) return "none";
  if (last.result === "FAIL") return "failed";
  if (!last.nextDue) return "ok";
  if (last.nextDue < today) return "overdue";
  return last.nextDue <= addDays(today, warnDays) ? "soon" : "ok";
}
export const CHECK_STATE_LABELS: Record<CheckState, string> = { failed: "Failed", overdue: "Overdue", soon: `Due within ${CHECK_WARN_DAYS} days`, ok: "In date", none: "No record" };

export const TONE = { expired: "danger", expiring: "warn", failed: "danger", overdue: "danger", soon: "warn", ok: "ok", none: "neutral" } as const;

/** Next due date of a passed check: `months` later. A failed one has none (retest after the fix). */
export function nextCheckDue(on: string, months: number, result: "PASS" | "FAIL"): string | null {
  return result === "PASS" ? addMonths(on, months > 0 ? months : 12) : null;
}

/** Usual physicist QC tests, offered on the form (free text is allowed too). */
export const QC_TESTS = [
  "Annual physicist QC (acceptance criteria)", "Tube output and kV accuracy", "Half value layer", "Exposure timer and AEC",
  "Image quality phantom", "CT dose index (CTDI)", "Fluoroscopy dose rate", "Room shielding survey", "Light field and collimation",
] as const;
export const QC_DEFAULT_MONTHS = 12;

export const PROTECTIVE_KINDS = ["APRON", "THYROID", "GLOVES", "GLASSES", "SHIELD", "OTHER"] as const;
export type ProtectiveKind = (typeof PROTECTIVE_KINDS)[number];
export const PROTECTIVE_KIND_LABELS: Record<ProtectiveKind, string> = {
  APRON: "Lead apron", THYROID: "Thyroid collar", GLOVES: "Lead gloves", GLASSES: "Lead glasses", SHIELD: "Mobile shield", OTHER: "Other",
};

/* ── Dosimetry ── */

/** Occupational effective dose limit, mSv a year (ICRP 103, as adopted by ENRRA). */
export const ANNUAL_LIMIT_MSV = 20;
/** Investigation level: a reading at or above this share of the period's limit is looked into. */
export const INVESTIGATION_SHARE = 0.3;

/** The limit for a badge period, pro rata of the annual limit (a month ≈ 1.67 mSv, a quarter = 5 mSv). */
export function periodLimit(start: string, end: string, annual = ANNUAL_LIMIT_MSV): number {
  const days = Math.max(1, daysBetween(start, end) + 1);
  return Math.round(((annual * Math.min(days, 366)) / 365) * 100) / 100;
}

export type DoseFlag = "OK" | "INVESTIGATE" | "OVER";
export const DOSE_FLAG_LABELS: Record<DoseFlag, string> = { OK: "Below investigation level", INVESTIGATE: "Investigate", OVER: "Over the limit" };
export const DOSE_FLAG_TONE = { OK: "ok", INVESTIGATE: "warn", OVER: "danger" } as const;

export function doseFlag(doseMsv: number, limitMsv: number, share = INVESTIGATION_SHARE): DoseFlag {
  if (doseMsv > limitMsv) return "OVER";
  if (doseMsv >= limitMsv * share) return "INVESTIGATE";
  return "OK";
}

/* ── A room's status ── */

export type RoomInput = { licences: ExpiryState[]; qc: CheckState[]; protective: CheckState[]; radiationDevices: number };
export type RoomStatus = { state: "problem" | "attention" | "ok"; reasons: string[] };

/** One status per room: a problem when it has radiation devices but no valid licence, or anything expired, failed or overdue. */
export function roomStatus(r: RoomInput): RoomStatus {
  const reasons: string[] = [];
  const valid = r.licences.filter((s) => s !== "expired").length;
  if (r.radiationDevices > 0 && valid === 0) reasons.push(r.licences.length ? "Licence expired" : "No ENRRA licence on record");
  else if (r.licences.includes("expired")) reasons.push("A licence has expired");
  const count = (l: CheckState[], s: CheckState) => l.filter((x) => x === s).length;
  const qcBad = count(r.qc, "failed") + count(r.qc, "overdue"), apBad = count(r.protective, "failed") + count(r.protective, "overdue");
  if (qcBad) reasons.push(`${qcBad} QC test${qcBad === 1 ? "" : "s"} failed or overdue`);
  if (r.radiationDevices > 0 && r.qc.length === 0) reasons.push("No physicist QC on record");
  if (apBad) reasons.push(`${apBad} protective item${apBad === 1 ? "" : "s"} failed or overdue`);
  if (reasons.length) return { state: "problem", reasons };
  const soon = r.licences.filter((s) => s === "expiring").length + count(r.qc, "soon") + count(r.protective, "soon");
  if (soon) return { state: "attention", reasons: [`${soon} item${soon === 1 ? "" : "s"} due soon`] };
  return { state: "ok", reasons: [] };
}

/** The latest record per key (rows sorted any way): highest date, then highest id. */
export function latestBy<T extends { id: number }>(rows: T[], key: (r: T) => string, date: (r: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r), cur = m.get(k);
    if (!cur || date(r) > date(cur) || (date(r) === date(cur) && r.id > cur.id)) m.set(k, r);
  }
  return m;
}

/**
 * Failure codes (wave 40): one standard code per finished job, so failures can be counted by cause on the Analytics
 * Maintenance tab. Required when a corrective job is completed on the work order page; older jobs without one get a
 * warning when they are signed off, not a block. The code can be changed later on the job page. Pure.
 */
export const FAILURE_CODES = [
  "USER_ERROR", "NO_PROBLEM_FOUND", "WEAR", "ELECTRICAL", "MECHANICAL", "SOFTWARE", "NETWORK", "BATTERY",
  "ACCESSORY", "DAMAGE_ABUSE", "ENVIRONMENT", "CALIBRATION_DRIFT", "PART_FAILURE", "OTHER",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

export const FAILURE_CODE_LABEL: Record<FailureCode, string> = {
  USER_ERROR: "User error",
  NO_PROBLEM_FOUND: "No problem found",
  WEAR: "Wear and tear",
  ELECTRICAL: "Electrical fault",
  MECHANICAL: "Mechanical fault",
  SOFTWARE: "Software fault",
  NETWORK: "Network or connection",
  BATTERY: "Battery",
  ACCESSORY: "Accessory or probe",
  DAMAGE_ABUSE: "Damage or misuse",
  ENVIRONMENT: "Power, water or room conditions",
  CALIBRATION_DRIFT: "Out of calibration",
  PART_FAILURE: "Part failed",
  OTHER: "Other",
};

export const FAILURE_CODE_OPTIONS = FAILURE_CODES.map((c) => ({ value: c, label: FAILURE_CODE_LABEL[c] }));

export function isFailureCode(v: unknown): v is FailureCode {
  return typeof v === "string" && (FAILURE_CODES as readonly string[]).includes(v);
}

export function failureCodeLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return isFailureCode(v) ? FAILURE_CODE_LABEL[v] : v;
}

export const FAILURE_CODE_NEEDED = "Choose a failure code: what caused the fault (choose No problem found when nothing was wrong).";

/**
 * Problem with the failure code given when a job is completed, or null. A corrective job needs one unless
 * `optional` (the offline My jobs sync, which may send it or not). Any job may carry one.
 */
export function failureCodeProblem(type: string, code: string | null | undefined, optional = false): string | null {
  if (code && !isFailureCode(code)) return "That failure code isn't on the list.";
  if (!code && type === "CORRECTIVE" && !optional) return FAILURE_CODE_NEEDED;
  return null;
}

/** Warning before signing off a corrective job finished without a failure code (older jobs). */
export function failureCodeWarning(wo: { type: string; failureCode: string | null }): string | null {
  return wo.type === "CORRECTIVE" && !wo.failureCode ? "No failure code is recorded for this job. Add one below so it counts in the failure analysis." : null;
}

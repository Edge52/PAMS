/**
 * Electrical safety tests after IEC 62353 (wave 23): the limits and the pass or fail decision. Pure.
 *
 * The limits below are the standard's usual figures for recurrent tests and tests after repair. They are shown on
 * the form beside each reading. Check them against the hospital's own copy of IEC 62353 and the maker's manual:
 * a maker may state stricter values, and those then apply.
 */
export const PROTECTION_CLASSES = ["I", "II", "INTERNAL"] as const;
export type ProtectionClass = (typeof PROTECTION_CLASSES)[number];
export const CLASS_LABELS: Record<ProtectionClass, string> = { I: "Class I (earthed)", II: "Class II (double insulated)", INTERNAL: "Internally powered (battery)" };

export const APPLIED_PARTS = ["NONE", "B", "BF", "CF"] as const;
export type AppliedPart = (typeof APPLIED_PARTS)[number];
export const APPLIED_PART_LABELS: Record<AppliedPart, string> = { NONE: "No applied part", B: "Type B", BF: "Type BF", CF: "Type CF" };

export const METHODS = ["DIRECT", "DIFFERENTIAL", "ALTERNATIVE"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABELS: Record<Method, string> = { DIRECT: "Direct", DIFFERENTIAL: "Differential", ALTERNATIVE: "Alternative" };

/** Protective earth resistance, ohms: device with its detachable mains cord. */
export const EARTH_LIMIT_OHM = 0.3;
/** Insulation resistance, megohms: a common acceptance figure; IEC 62353 leaves the value to the maker. */
export const INSULATION_MIN_MOHM = 2;

/** Equipment leakage current limit in microamps, by class and method. Internally powered equipment has no mains test. */
export function equipmentLeakageLimit(cls: ProtectionClass, method: Method): number | null {
  if (cls === "INTERNAL") return null;
  if (method === "ALTERNATIVE") return cls === "I" ? 1000 : 500;
  return cls === "I" ? 500 : 100;
}
/** Applied part leakage current limit in microamps (type F parts only: BF and CF). */
export function appliedPartLeakageLimit(part: AppliedPart): number | null {
  return part === "BF" ? 5000 : part === "CF" ? 50 : null;
}

export type Reading = {
  protectionClass: ProtectionClass; appliedPart: AppliedPart; method: Method; visualOk: boolean; functionalOk: boolean;
  earthResistanceOhm?: number | null; insulationMOhm?: number | null; equipmentLeakageUa?: number | null; appliedPartLeakageUa?: number | null;
};

/** The checks a test of this kind of device must include, with their limits. */
export function requiredChecks(r: Pick<Reading, "protectionClass" | "appliedPart" | "method">) {
  return {
    earth: r.protectionClass === "I" ? EARTH_LIMIT_OHM : null,
    equipmentLeakage: equipmentLeakageLimit(r.protectionClass, r.method),
    appliedPartLeakage: appliedPartLeakageLimit(r.appliedPart),
  };
}

/** Pass or fail, with each failed or missing check in words. A missing required reading fails the test. */
export function judge(r: Reading): { result: "PASS" | "FAIL"; failures: string[] } {
  const need = requiredChecks(r), failures: string[] = [];
  if (!r.visualOk) failures.push("Visual inspection failed.");
  if (need.earth != null) {
    if (r.earthResistanceOhm == null) failures.push("Protective earth resistance was not measured.");
    else if (r.earthResistanceOhm > need.earth) failures.push(`Protective earth resistance ${r.earthResistanceOhm} Ω is over ${need.earth} Ω.`);
  }
  if (r.insulationMOhm != null && r.insulationMOhm < INSULATION_MIN_MOHM) failures.push(`Insulation resistance ${r.insulationMOhm} MΩ is under ${INSULATION_MIN_MOHM} MΩ.`);
  if (need.equipmentLeakage != null) {
    if (r.equipmentLeakageUa == null) failures.push("Equipment leakage current was not measured.");
    else if (r.equipmentLeakageUa > need.equipmentLeakage) failures.push(`Equipment leakage ${r.equipmentLeakageUa} µA is over ${need.equipmentLeakage} µA.`);
  }
  if (need.appliedPartLeakage != null) {
    if (r.appliedPartLeakageUa == null) failures.push("Applied part leakage current was not measured.");
    else if (r.appliedPartLeakageUa > need.appliedPartLeakage) failures.push(`Applied part leakage ${r.appliedPartLeakageUa} µA is over ${need.appliedPartLeakage} µA.`);
  }
  if (!r.functionalOk) failures.push("Functional test failed.");
  return { result: failures.length ? "FAIL" : "PASS", failures };
}

/** Why an analyser can't be used for a test on this day, or null when it can. */
export function analyserProblem(a: { calibrationDue?: string | null; label: string }, testedOn: string): string | null {
  if (!a.calibrationDue) return `${a.label} has no calibration date on record. Enter it on the analyser's asset page first.`;
  if (a.calibrationDue < testedOn) return `${a.label}'s calibration ran out on ${a.calibrationDue}. Readings taken with it can't be accepted until it is recalibrated.`;
  return null;
}

/** When the next test falls due: `months` after this one (12 when the type gives no interval). */
export function nextTestDue(testedOn: string, months: number | null | undefined): string {
  const d = new Date(`${testedOn}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + (months && months > 0 ? months : 12));
  return d.toISOString().slice(0, 10);
}

export type DueState = "overdue" | "soon" | "ok" | "never";
/** Where a device stands against its next test date; "soon" is within 30 days. */
export function testDueState(nextDue: string | null | undefined, today: string): DueState {
  if (!nextDue) return "never";
  if (nextDue < today) return "overdue";
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return nextDue <= soon.toISOString().slice(0, 10) ? "soon" : "ok";
}

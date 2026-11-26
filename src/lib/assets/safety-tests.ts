/**
 * Electrical safety tests after IEC 62353 (wave 23): the limits and the pass or fail decision. Pure.
 *
 * The limits below are the standard's usual figures for recurrent tests and tests after repair. They are shown on
 * the form beside each reading. Check them against the hospital's own copy of IEC 62353 and the maker's manual:
 * a maker may state stricter values, and those then apply.
 */
import { addMonths } from "./dates";

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
/** Insulation resistance, megohms, mains to protective earth of a class I device (Rigel IEC 62353 guide). The
 *  single reading kept on safety_tests.insulation_mohm is judged against this (class I) or 7 MΩ (class II). */
export const INSULATION_MIN_MOHM = 2;

/**
 * Insulation test paths at 500 V DC and their minimums, megohms (wave 40; source: Rigel IEC 62353 guide, insulation
 * pass/fail table). IEC 62353 itself leaves the value to the maker: a maker's own figure takes precedence.
 */
export const INSULATION_PATHS = ["MAINS_PE", "MAINS_ACCESSIBLE", "AP_PE", "AP_MAINS"] as const;
export type InsulationPath = (typeof INSULATION_PATHS)[number];
export const INSULATION_PATH_LABELS: Record<InsulationPath, string> = {
  MAINS_PE: "Mains to protective earth (class I)", MAINS_ACCESSIBLE: "Mains to non-earthed accessible parts",
  AP_PE: "Applied parts to protective earth", AP_MAINS: "Applied parts to mains",
};
export function insulationLimit(path: InsulationPath, cls: ProtectionClass, part: AppliedPart): number | null {
  if (cls === "INTERNAL") return null;
  switch (path) {
    case "MAINS_PE": return cls === "I" ? 2 : null;
    case "MAINS_ACCESSIBLE": return 7;
    case "AP_PE": return part === "NONE" ? null : 70;
    case "AP_MAINS": return part === "NONE" ? null : part === "B" ? (cls === "I" ? 2 : 7) : 70;
  }
}

/** Device types tested as mobile X-ray generators (higher equipment leakage allowed) and defibrillators (CF paddles). */
export const MOBILE_XRAY_CODES = ["IMG-XR-MDR", "IMG-XR-MXR", "IMG-XR-PORT", "IMG-XR-CARM", "IMG-XR-CARMFP", "IMG-CT-MOB"] as const;
export const DEFIB_PREFIX = "LIF-DEF";
export function specialKind(code: string | null | undefined): { mobileXray: boolean; defibPaddles: boolean } {
  const c = (code ?? "").toUpperCase();
  return { mobileXray: (MOBILE_XRAY_CODES as readonly string[]).includes(c), defibPaddles: (c === DEFIB_PREFIX || c.startsWith(`${DEFIB_PREFIX}-`)) && c !== "LIF-DEF-CPR" };
}

/**
 * Equipment leakage current limit in microamps, by class and method (Rigel IEC 62353 guide, Appendix A): direct or
 * differential 500 (class I) / 100 (class II), alternative 1000 / 500; mobile X-ray generators 2000 direct or
 * differential, 5000 alternative. Internally powered equipment has no mains test.
 */
export function equipmentLeakageLimit(cls: ProtectionClass, method: Method, mobileXray = false): number | null {
  if (cls === "INTERNAL") return null;
  if (mobileXray) return method === "ALTERNATIVE" ? 5000 : 2000;
  if (method === "ALTERNATIVE") return cls === "I" ? 1000 : 500;
  return cls === "I" ? 500 : 100;
}
/** Applied part leakage current limit in microamps (type F parts only: BF 5000, CF 50; defibrillator CF paddles 100,
 *  Rigel IEC 62353 guide). */
export function appliedPartLeakageLimit(part: AppliedPart, defibPaddles = false): number | null {
  return part === "BF" ? 5000 : part === "CF" ? (defibPaddles ? 100 : 50) : null;
}

export type Reading = {
  protectionClass: ProtectionClass; appliedPart: AppliedPart; method: Method; visualOk: boolean; functionalOk: boolean;
  earthResistanceOhm?: number | null; insulationMOhm?: number | null; equipmentLeakageUa?: number | null; appliedPartLeakageUa?: number | null;
  /** Wave 40: readings by insulation test path, and the device kinds with their own limits. */
  insulation?: { path: InsulationPath; mohm: number }[]; mobileXray?: boolean; defibPaddles?: boolean;
};

/** The checks a test of this kind of device must include, with their limits. */
export function requiredChecks(r: Pick<Reading, "protectionClass" | "appliedPart" | "method" | "mobileXray" | "defibPaddles">) {
  return {
    earth: r.protectionClass === "I" ? EARTH_LIMIT_OHM : null,
    equipmentLeakage: equipmentLeakageLimit(r.protectionClass, r.method, r.mobileXray ?? false),
    appliedPartLeakage: appliedPartLeakageLimit(r.appliedPart, r.defibPaddles ?? false),
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
  const mainMin = r.protectionClass === "II" ? 7 : INSULATION_MIN_MOHM;
  if (r.insulationMOhm != null && r.insulationMOhm < mainMin) failures.push(`Insulation resistance ${r.insulationMOhm} MΩ is under ${mainMin} MΩ.`);
  for (const x of r.insulation ?? []) {
    const lim = insulationLimit(x.path, r.protectionClass, r.appliedPart);
    if (lim != null && x.mohm < lim) failures.push(`Insulation ${INSULATION_PATH_LABELS[x.path].toLowerCase()} ${x.mohm} MΩ is under ${lim} MΩ.`);
  }
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

/** When the next test falls due: `months` after this one (12 when the type gives no interval), clamped to the month end. */
export function nextTestDue(testedOn: string, months: number | null | undefined): string {
  return addMonths(testedOn, months && months > 0 ? months : 12);
}

export type DueState = "overdue" | "soon" | "ok" | "never";
/** Where a device stands against its next test date; "soon" is within 30 days. */
export function testDueState(nextDue: string | null | undefined, today: string): DueState {
  if (!nextDue) return "never";
  if (nextDue < today) return "overdue";
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return nextDue <= soon.toISOString().slice(0, 10) ? "soon" : "ok";
}

/* ── Wave 40: a passed test at acceptance and after a repair (warn, not block) ── */

export type SafetyGate = { context: "ACCEPTANCE" | "REPAIR"; inProgramme: boolean; passedSince: boolean };
/**
 * Whether to ask for a reason before going on: the device is in the electrical safety programme (it, or a device of
 * its type in the hospital, has a test on record) and has no passed test since the work began (repair) or ever
 * (acceptance). Returns the warning, or null.
 */
export function safetyGateWarning(g: SafetyGate): string | null {
  if (!g.inProgramme || g.passedSince) return null;
  return g.context === "REPAIR"
    ? "No passed electrical safety test since this repair began (IEC 62353 asks for one after every repair). Record the test first, or give the reason to go on without it."
    : "No passed electrical safety test for this device yet (IEC 62353 asks for one before first use). Record the test first, or give the reason to go on without it.";
}

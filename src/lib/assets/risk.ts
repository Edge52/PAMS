/**
 * Risk score and maintenance strategy per device type (wave 23). Pure.
 *
 * The score is the equipment management (EM) number of Fennigkoh and Smith (1989), the method most hospital
 * equipment programmes start from: equipment function (2–10) + physical risk (1–5) + maintenance requirement (1–5).
 * A type scoring 12 or more belongs in the planned maintenance programme. AAMI EQ89 asks that the strategy chosen
 * for each type, and the reason, be written down; that is what `maintenanceStrategy` and `strategyReason` hold.
 *
 * Wave 39: an alternative equipment maintenance (AEM) programme is not allowed for imaging and radiological equipment
 * (CMS S&C 14-07: X-ray, CT, MRI, nuclear medicine, radiotherapy), for medical lasers, or for new equipment without
 * enough maintenance history (Joint Commission FAQ). It must rest on evidence; that is `evidence`.
 */
import { isRadiationType } from "./radiation";
export const FUNCTION_SCORES = [
  { value: 10, label: "Life support" },
  { value: 9, label: "Surgical and intensive care" },
  { value: 8, label: "Physical therapy and treatment" },
  { value: 7, label: "Surgical and intensive care monitoring" },
  { value: 6, label: "Other physiological monitoring and diagnostic" },
  { value: 5, label: "Analytical laboratory" },
  { value: 4, label: "Laboratory accessories" },
  { value: 3, label: "Computers and related" },
  { value: 2, label: "Patient related and other" },
] as const;
export const PHYSICAL_SCORES = [
  { value: 5, label: "A failure could cause death" },
  { value: 4, label: "A failure could injure the patient or operator" },
  { value: 3, label: "Wrong therapy or misdiagnosis" },
  { value: 2, label: "Damage to the equipment" },
  { value: 1, label: "No significant risk" },
] as const;
export const MAINTENANCE_SCORES = [
  { value: 5, label: "Extensive: routine calibration and part replacement" },
  { value: 4, label: "Above average" },
  { value: 3, label: "Average: performance checks and safety tests" },
  { value: 2, label: "Below average" },
  { value: 1, label: "Minimal: visual inspection" },
] as const;

export const STRATEGIES = ["MANUFACTURER", "ALTERNATIVE", "RUN_TO_FAILURE"] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_LABELS: Record<Strategy, string> = {
  MANUFACTURER: "Maker's schedule", ALTERNATIVE: "Hospital's own schedule", RUN_TO_FAILURE: "Repair when it fails",
};
export const STRATEGY_HINTS: Record<Strategy, string> = {
  MANUFACTURER: "Planned maintenance at the intervals and with the checks the manufacturer gives.",
  ALTERNATIVE: "Planned maintenance at intervals the hospital set from its own history and risk.",
  RUN_TO_FAILURE: "No planned visits: checked when used and repaired or replaced when it fails.",
};

/** A score of 12 or more is in the planned maintenance programme. */
export const INCLUDE_AT = 12;

export type RiskInput = { riskFunction?: number | null; riskPhysical?: number | null; riskMaintenance?: number | null };

/** The EM number, or null until all three parts are scored. */
export function emNumber(r: RiskInput): number | null {
  if (r.riskFunction == null || r.riskPhysical == null || r.riskMaintenance == null) return null;
  return r.riskFunction + r.riskPhysical + r.riskMaintenance;
}

export type RiskLevel = "high" | "medium" | "low";
export function riskLevel(em: number | null): RiskLevel | null {
  if (em == null) return null;
  return em >= 17 ? "high" : em >= INCLUDE_AT ? "medium" : "low";
}

/** Months between planned visits suggested by the maintenance requirement alone (a starting point, not a rule). */
export function suggestedIntervalMonths(riskMaintenance: number | null | undefined): number | null {
  if (riskMaintenance == null) return null;
  return riskMaintenance >= 4 ? 6 : riskMaintenance >= 2 ? 12 : null;
}

/** MRI (whole-body, open and extremity). */
export const MRI_PREFIXES = ["IMG-MRI"] as const;
/** Medical lasers in the taxonomy: surgical, dermatology, ophthalmic, IVF and therapy lasers. */
export const LASER_PREFIXES = ["SUR-LAS", "DRM-LAS", "SUR-OPH-EXC", "SUR-OPH-FEM", "SUR-OPH-YAG", "SUR-OPH-GLAS", "OBG-IVF-LAS", "REH-ELT-LAS"] as const;
const under = (code: string, prefix: string) => code === prefix || code.startsWith(prefix + "-");

/** Why a type must follow the maker's schedule whatever its score (null = no such rule). Pass the type's code. */
export function makerOnlyReason(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (isRadiationType(c)) return "Imaging and radiation equipment";
  if (MRI_PREFIXES.some((p) => under(c, p))) return "MRI";
  if (LASER_PREFIXES.some((p) => under(c, p))) return "Medical lasers";
  return null;
}

/** The hospital's own history with a type: the most recently installed device and the fewest completed PPMs. */
export type FleetHistory = { newestMonths: number | null; fewestPpms: number | null };
export type HistoryRule = { minMonths: number; minPpms: number };
export const DEFAULT_HISTORY_RULE: HistoryRule = { minMonths: 12, minPpms: 2 };

/** Whole months between two ISO dates (0 when `to` is before `from`). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

export type StrategyInput = RiskInput & {
  code?: string | null; maintenanceStrategy?: Strategy | null; strategyReason?: string | null; ppmIntervalMonths?: number | null;
  criticality?: string | null; evidence?: string | null; fleet?: FleetHistory | null; rule?: HistoryRule;
};

/**
 * Why the hospital's own schedule or repair-when-it-fails is not allowed for this type, or null. Sources: CMS S&C
 * 14-07 (no AEM for imaging/radiology equipment and medical lasers; new equipment follows the maker until there is
 * history) and the Joint Commission FAQ on AEM programmes.
 */
export function strategyRefusal(t: StrategyInput): string | null {
  if (t.maintenanceStrategy !== "ALTERNATIVE" && t.maintenanceStrategy !== "RUN_TO_FAILURE") return null;
  const label = t.maintenanceStrategy === "ALTERNATIVE" ? "the hospital's own schedule" : "repair when it fails";
  const kind = makerOnlyReason(t.code);
  if (kind) return `${kind} must follow the maker's schedule: ${label} is not allowed (CMS S&C 14-07).`;
  const rule = t.rule ?? DEFAULT_HISTORY_RULE;
  if (t.fleet?.newestMonths != null && t.fleet.newestMonths < rule.minMonths) {
    return `A device of this type was installed ${t.fleet.newestMonths} month${t.fleet.newestMonths === 1 ? "" : "s"} ago: keep the maker's schedule until every one has ${rule.minMonths} months of history (not ${label}).`;
  }
  if (t.fleet?.fewestPpms != null && t.fleet.fewestPpms < rule.minPpms) {
    return `A device of this type has ${t.fleet.fewestPpms} completed planned visit${t.fleet.fewestPpms === 1 ? "" : "s"}: keep the maker's schedule until every one has ${rule.minPpms} (not ${label}).`;
  }
  return null;
}

/** What needs attention in a type's risk record, in plain words. Empty when it is complete and consistent. */
export function strategyProblems(t: StrategyInput): string[] {
  const out: string[] = [];
  const em = emNumber(t);
  if (em == null) out.push("Not scored yet.");
  if (!t.maintenanceStrategy) out.push("No maintenance strategy chosen.");
  else if (!t.strategyReason?.trim()) out.push("The reason for the strategy is not written down.");
  if (em != null && em >= INCLUDE_AT && t.maintenanceStrategy === "RUN_TO_FAILURE") out.push(`Scores ${em} (12 or more) but is set to repair when it fails.`);
  if (t.criticality === "LIFE_SUPPORT" && t.maintenanceStrategy === "RUN_TO_FAILURE") out.push("Life support equipment should not run to failure.");
  if (t.maintenanceStrategy && t.maintenanceStrategy !== "RUN_TO_FAILURE" && !t.ppmIntervalMonths) out.push("Planned maintenance is chosen but no interval is set.");
  if (t.maintenanceStrategy === "RUN_TO_FAILURE" && t.ppmIntervalMonths) out.push("Set to repair when it fails, yet a planned interval is set.");
  const refusal = strategyRefusal(t);
  if (refusal) out.push(refusal);
  if (t.maintenanceStrategy === "ALTERNATIVE" && !t.evidence?.trim()) out.push("The evidence or risk basis for the hospital's own schedule is not written down.");
  return out;
}

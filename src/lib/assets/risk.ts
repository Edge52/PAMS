/**
 * Risk score and maintenance strategy per device type (wave 23). Pure.
 *
 * The score is the equipment management (EM) number of Fennigkoh and Smith (1989), the method most hospital
 * equipment programmes start from: equipment function (2–10) + physical risk (1–5) + maintenance requirement (1–5).
 * A type scoring 12 or more belongs in the planned maintenance programme. AAMI EQ89 asks that the strategy chosen
 * for each type, and the reason, be written down; that is what `maintenanceStrategy` and `strategyReason` hold.
 */
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

/** What needs attention in a type's risk record, in plain words. Empty when it is complete and consistent. */
export function strategyProblems(t: RiskInput & { maintenanceStrategy?: Strategy | null; strategyReason?: string | null; ppmIntervalMonths?: number | null; criticality?: string | null }): string[] {
  const out: string[] = [];
  const em = emNumber(t);
  if (em == null) out.push("Not scored yet.");
  if (!t.maintenanceStrategy) out.push("No maintenance strategy chosen.");
  else if (!t.strategyReason?.trim()) out.push("The reason for the strategy is not written down.");
  if (em != null && em >= INCLUDE_AT && t.maintenanceStrategy === "RUN_TO_FAILURE") out.push(`Scores ${em} (12 or more) but is set to repair when it fails.`);
  if (t.criticality === "LIFE_SUPPORT" && t.maintenanceStrategy === "RUN_TO_FAILURE") out.push("Life support equipment should not run to failure.");
  if (t.maintenanceStrategy && t.maintenanceStrategy !== "RUN_TO_FAILURE" && !t.ppmIntervalMonths) out.push("Planned maintenance is chosen but no interval is set.");
  if (t.maintenanceStrategy === "RUN_TO_FAILURE" && t.ppmIntervalMonths) out.push("Set to repair when it fails, yet a planned interval is set.");
  return out;
}

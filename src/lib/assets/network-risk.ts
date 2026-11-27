/**
 * Network risk per connection (wave 41, IEC 80001-1:2021). Pure.
 *
 * Each connection of a device to another system is a risk entry: the hazard, its likelihood and severity before the
 * controls (1–5 each), the controls, and the residual likelihood and severity after them. Risk = likelihood ×
 * severity on the usual 5 × 5 matrix: 1–4 low, 5–12 medium, 15–25 high. The owner reviews it by the review date.
 */
export const RISK_STATUSES = ["OPEN", "ACCEPTED", "CLOSED"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_STATUS_LABELS: Record<RiskStatus, string> = { OPEN: "Open", ACCEPTED: "Residual risk accepted", CLOSED: "Closed (connection removed)" };

export const LIKELIHOOD = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"] as const;
export const SEVERITY = ["Negligible", "Minor", "Serious", "Major", "Catastrophic"] as const;

export type RiskLevel = "low" | "medium" | "high";
export const riskScore = (likelihood: number, severity: number) => likelihood * severity;
export function riskLevel(score: number): RiskLevel {
  return score >= 15 ? "high" : score >= 5 ? "medium" : "low";
}
export const LEVEL_LABELS: Record<RiskLevel, string> = { low: "Low", medium: "Medium", high: "High" };

export type RiskEntry = {
  connectsTo: string; hazard: string; likelihood: number; severity: number; controls: string | null;
  residualLikelihood: number; residualSeverity: number; owner: string | null; reviewDue: string | null; status: string;
};

/** What is wrong with a risk entry before it is saved, by field name. Empty when it can be saved. */
export function riskProblems(e: RiskEntry, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
  for (const k of ["likelihood", "severity", "residualLikelihood", "residualSeverity"] as const) if (!ok(e[k])) out[k] = "Choose 1 to 5.";
  if (!e.connectsTo.trim()) out.connectsTo = "Say what system the device connects to.";
  if (!e.hazard.trim()) out.hazard = "Say what could go wrong.";
  if (Object.keys(out).length) return out;
  if (riskScore(e.residualLikelihood, e.residualSeverity) > riskScore(e.likelihood, e.severity)) out.residualLikelihood = "The risk after the controls can't be higher than before them.";
  if (riskScore(e.residualLikelihood, e.residualSeverity) < riskScore(e.likelihood, e.severity) && !e.controls?.trim()) out.controls = "Say which controls lower the risk.";
  if (e.status === "ACCEPTED" && !e.owner?.trim()) out.owner = "Accepted risk needs an owner who accepted it.";
  if (e.status !== "CLOSED" && e.reviewDue && e.reviewDue < today) out.reviewDue = "The review date is in the past.";
  return out;
}

/** Counts for the device's security concerns: open risks still high after controls, and reviews overdue. */
export function riskSummary(list: RiskEntry[], today: string): { risks: number; highResidual: number; reviewOverdue: number } {
  const live = list.filter((r) => r.status !== "CLOSED");
  return {
    risks: live.length,
    highResidual: live.filter((r) => r.status === "OPEN" && riskLevel(riskScore(r.residualLikelihood, r.residualSeverity)) === "high").length,
    reviewOverdue: live.filter((r) => r.reviewDue != null && r.reviewDue < today).length,
  };
}

/**
 * Per-device performance and the replacement score. Pure — the asset page, the replacement plan and the tests share it.
 * Money arrives already converted to one currency (EGP) by the caller.
 */
const H = 3_600_000, D = 24 * H;

export type KpiJob = { type: string; status: string; reportedAt: Date; completedAt: Date | null; downtimeStart: Date | null; downtimeEnd: Date | null };

export type DeviceKpis = {
  windowDays: number;
  /** Share of the window the device was usable, 0–100. */
  uptimePct: number;
  downtimeHours: number;
  failures: number;
  mtbfDays: number | null;
  mttrHours: number | null;
};

/**
 * Over the last `windowDays` (or since install, if later): downtime from work orders that kept the device down,
 * failures = corrective jobs reported, MTBF = in-service time ÷ failures, MTTR = mean report→completion of corrective jobs.
 */
export function deviceKpis(jobs: KpiJob[], inServiceSince: Date | null, now: Date, windowDays = 365): DeviceKpis {
  const from = new Date(Math.max(now.getTime() - windowDays * D, inServiceSince?.getTime() ?? 0));
  const span = Math.max(1, now.getTime() - from.getTime());
  let down = 0;
  for (const j of jobs) {
    if (!j.downtimeStart || j.status === "CANCELLED") continue;
    const a = Math.max(j.downtimeStart.getTime(), from.getTime());
    const b = Math.min((j.downtimeEnd ?? now).getTime(), now.getTime());
    if (b > a) down += b - a;
  }
  down = Math.min(down, span);
  const failures = jobs.filter((j) => j.type === "CORRECTIVE" && j.status !== "CANCELLED" && j.reportedAt >= from);
  const repaired = failures.filter((j) => j.completedAt);
  return {
    windowDays: Math.round(span / D),
    uptimePct: Math.round(((span - down) / span) * 1000) / 10,
    downtimeHours: Math.round((down / H) * 10) / 10,
    failures: failures.length,
    mtbfDays: failures.length ? Math.round(((span - down) / D / failures.length) * 10) / 10 : null,
    mttrHours: repaired.length ? Math.round((repaired.reduce((s, j) => s + (j.completedAt!.getTime() - j.reportedAt.getTime()), 0) / repaired.length / H) * 10) / 10 : null,
  };
}

/** Total cost of ownership so far: purchase + maintenance + service-contract share. */
export function costOfOwnership(purchase: number | null, maintenance: number, contracts: number): { total: number; maintenancePct: number | null } {
  const p = purchase ?? 0;
  const total = Math.round((p + maintenance + contracts) * 100) / 100;
  return { total, maintenancePct: p > 0 ? Math.round(((maintenance + contracts) / p) * 1000) / 10 : null };
}

export type ReplacementInput = {
  /** Share of life expectancy used (age ÷ life × 100), null when unknown. */
  lifeUsedPct: number | null;
  /** Maintenance spend over the last three years ÷ purchase cost, null when the purchase cost is unknown. */
  repairCostRatio: number | null;
  failures12m: number;
  downtimeHours12m: number;
  criticality: string | null;
  condition: string;
  openRecall: boolean;
};

export type ReplacementBand = "REPLACE" | "PLAN" | "KEEP";
export type ReplacementScore = { score: number; band: ReplacementBand; reasons: string[] };

/**
 * 0–100, higher = replace sooner. Weights: age 35, repair cost 20, failures 15, downtime 10, criticality 10,
 * condition 10 (+5 for an open recall), capped at 100. REPLACE ≥ 60, PLAN ≥ 35.
 */
export function replacementScore(i: ReplacementInput): ReplacementScore {
  const reasons: string[] = [];
  let s = 0;
  if (i.lifeUsedPct != null) {
    const age = Math.min(35, (Math.min(i.lifeUsedPct, 100) / 100) * 30 + (i.lifeUsedPct >= 100 ? 5 : 0));
    s += age;
    if (i.lifeUsedPct >= 100) reasons.push(`Past its expected life (${Math.round(i.lifeUsedPct)} % used)`);
    else if (i.lifeUsedPct >= 80) reasons.push(`Near the end of its life (${Math.round(i.lifeUsedPct)} % used)`);
  }
  if (i.repairCostRatio != null && i.repairCostRatio > 0) {
    s += Math.min(20, i.repairCostRatio * 40);
    if (i.repairCostRatio >= 0.3) reasons.push(`Repairs cost ${Math.round(i.repairCostRatio * 100)} % of its price in 3 years`);
  }
  if (i.failures12m) {
    s += Math.min(15, i.failures12m * 5);
    if (i.failures12m >= 2) reasons.push(`${i.failures12m} failures in 12 months`);
  }
  if (i.downtimeHours12m) {
    s += Math.min(10, (i.downtimeHours12m / 336) * 10);
    if (i.downtimeHours12m >= 168) reasons.push(`Out of use ${Math.round(i.downtimeHours12m / 24)} days in 12 months`);
  }
  s += ({ LIFE_SUPPORT: 10, HIGH: 6, MEDIUM: 3 } as Record<string, number>)[i.criticality ?? ""] ?? 0;
  if (i.condition === "CONDEMNED") { s += 10; reasons.push("Condemned"); }
  else if (i.condition === "POOR") { s += 5; reasons.push("Poor condition"); }
  if (i.openRecall) { s += 5; reasons.push("Open recall"); }
  const score = Math.min(100, Math.round(s));
  return { score, band: score >= 60 ? "REPLACE" : score >= 35 ? "PLAN" : "KEEP", reasons };
}

export const BAND_LABEL: Record<ReplacementBand, string> = { REPLACE: "Replace now", PLAN: "Plan replacement", KEEP: "Keep" };

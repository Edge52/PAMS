/**
 * Medical equipment management plan (wave 40, GAHAR 2025 standards EFS.10 EOC 1): the KPIs a plan can set targets
 * for, reading them from a form, and judging a KPI snapshot against its targets. Pure (tested).
 */
import type { PlanKpi, PlanKpiSnapshot } from "../../db/schema-wave40-h";

export type KpiKey = "ppm_on_time" | "calibration_on_time" | "safety_tests_on_time" | "incidents" | "recalls_closed" | "training_coverage" | "uptime";

/** "higher" = the figure should be at or above the target; "lower" = at or below (incidents). */
export const PLAN_KPIS: { key: KpiKey; label: string; unit: "%" | "count"; target: number; better: "higher" | "lower"; help: string }[] = [
  { key: "ppm_on_time", label: "PPM done on time", unit: "%", target: 90, better: "higher", help: "Planned maintenance done within the grace days, from the PPM compliance report." },
  { key: "calibration_on_time", label: "Calibration in date", unit: "%", target: 95, better: "higher", help: "Devices that need calibration whose calibration is in date today." },
  { key: "safety_tests_on_time", label: "Electrical safety tests in date", unit: "%", target: 95, better: "higher", help: "Tested devices whose last test passed and is not overdue." },
  { key: "incidents", label: "Device incidents with harm", unit: "count", target: 0, better: "lower", help: "Incidents in the period with minor or worse harm." },
  { key: "recalls_closed", label: "Recall actions done", unit: "%", target: 100, better: "higher", help: "Devices named in recalls that were actioned or found not affected." },
  { key: "training_coverage", label: "User training coverage", unit: "%", target: 80, better: "higher", help: "Department and device type pairs in use with at least one user whose training is current." },
  { key: "uptime", label: "Equipment available today", unit: "%", target: 95, better: "higher", help: "Devices in use that are working (not under maintenance or out of service)." },
];

export const KPI_KEYS = PLAN_KPIS.map((k) => k.key);
const byKey = new Map(PLAN_KPIS.map((k) => [k.key as string, k]));

export function defaultKpis(): PlanKpi[] {
  return PLAN_KPIS.map((k) => ({ key: k.key, label: k.label, target: k.target, unit: k.unit }));
}

/**
 * KPIs from a plan form: a tick `kpi_<key>` switches it on, `target_<key>` is its target. Returns the list or an
 * error. Percent targets are 0–100; counts 0–100000.
 */
export function kpisFromForm(get: (name: string) => string | null | undefined): { kpis: PlanKpi[] } | { error: string; field: string } {
  const out: PlanKpi[] = [];
  for (const k of PLAN_KPIS) {
    if (!get(`kpi_${k.key}`)) continue;
    const raw = (get(`target_${k.key}`) ?? "").trim();
    const t = raw === "" ? k.target : Number(raw);
    const max = k.unit === "%" ? 100 : 100000;
    if (!Number.isFinite(t) || t < 0 || t > max) return { error: `${k.label}: the target must be a number from 0 to ${max}.`, field: `target_${k.key}` };
    out.push({ key: k.key, label: k.label, target: Math.round(t * 10) / 10, unit: k.unit });
  }
  if (!out.length) return { error: "Choose at least one KPI for the plan.", field: "kpis" };
  return { kpis: out };
}

/** Whether a value meets its target (null when there is no value). */
export function kpiMet(key: string, value: number | null, target: number): boolean | null {
  if (value == null) return null;
  return byKey.get(key)?.better === "lower" ? value <= target : value >= target;
}

/** The snapshot stored with a review: each KPI of the plan with the value found and whether it met the target. */
export function kpiSnapshot(kpis: PlanKpi[], values: Partial<Record<string, number | null>>): PlanKpiSnapshot {
  return kpis.map((k) => {
    const v = values[k.key];
    const value = v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
    return { ...k, value, met: kpiMet(k.key, value, k.target) };
  });
}

export function kpiHelp(key: string): string {
  return byKey.get(key)?.help ?? "";
}

/** "92.5 %" or "3". */
export function kpiText(v: number | null, unit: "%" | "count"): string {
  if (v == null) return "No figure";
  return unit === "%" ? `${v} %` : String(v);
}

export const PLAN_STATUS_LABELS = { DRAFT: "Draft", SUBMITTED: "Waiting for approval", APPROVED: "Approved" } as const;
export const PLAN_STATUS_TONE = { DRAFT: "neutral", SUBMITTED: "warn", APPROVED: "ok" } as const;

/** Starting text for a new plan, so the form isn't blank (edit to fit the hospital). */
export const PLAN_TEMPLATE = {
  scope: "All medical equipment owned, leased, loaned or on trial in the hospital, from receipt and acceptance to disposal: inventory, user training, planned maintenance, calibration, electrical safety, repairs, incidents and recalls.",
  riskMethod: "Each device type is scored for equipment function (2–10), physical risk (1–5) and maintenance need (1–5). A total of 12 or more is in the planned maintenance programme. Life-support devices are always included.",
  maintenanceStrategy: "Planned maintenance at the maker's intervals for high-risk and life-support devices; risk-based intervals for others; repair when it fails only for low-risk items, with the reason recorded per device type. Calibration and electrical safety tests at the set intervals and after repairs.",
};

/** The plan of a year that counts: the approved one with the highest version, else the latest version. */
export function currentPlan<T extends { year: number; version: number; status: string }>(plans: T[], year: number): T | null {
  const ofYear = plans.filter((p) => p.year === year).sort((a, b) => b.version - a.version);
  return ofYear.find((p) => p.status === "APPROVED") ?? ofYear[0] ?? null;
}

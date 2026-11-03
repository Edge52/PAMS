/**
 * Imaging and equipment planning (wave 9): service contract performance (D6), imaging utilisation (D3), the year a
 * device goes in the capital plan (D4) and total cost of ownership of an offer (D5). Pure; hours and plain numbers.
 */

/* ── D6: contract performance ── */

export type ContractTerms = {
  responseHours: number | null; repairHours: number | null; uptimePct: number | null;
  penaltyPerLateHour: number | null; penaltyPerUptimePoint: number | null; penaltyCapPct: number | null;
  /** Contract value and dates, to cap penalties at a share of the value for the period. */
  value: number | null; startDate: string; endDate: string;
};
export type ContractJob = {
  id: number; number: string; tag: string; reportedAt: Date; startedAt: Date | null; completedAt: Date | null;
  deviceDown: boolean; downtimeStart: Date | null; downtimeEnd: Date | null;
};
export type JobPerformance = ContractJob & { responseH: number | null; repairH: number | null; lateH: number; open: boolean };
export type Statement = {
  jobs: JobPerformance[]; devices: number; periodHours: number; downtimeH: number; uptimePct: number | null;
  late: number; latePenalty: number; uptimeShort: number; uptimePenalty: number; cap: number | null; penalty: number; capped: boolean;
};

const H = 3_600_000;
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / H;

/**
 * A month's (or any period's) statement for a contract. Response is reported → work started; repair is reported →
 * device back up (or the job completed). A job is late by the larger of its response and repair overrun; penalties are
 * late hours × the hourly rate plus uptime points short × the point rate, capped at the cap % of the contract value
 * for the period. Jobs still open at the end of the period count up to then; lateness is charged in the month a job
 * was reported.
 */
export function contractStatement(t: ContractTerms, jobs: ContractJob[], devices: number, from: Date, to: Date): Statement {
  const end = (d: Date | null) => (d && d < to ? d : to);
  const rows: JobPerformance[] = jobs.map((j) => {
    const responseH = j.startedAt ? hours(j.reportedAt, j.startedAt) : j.completedAt ? hours(j.reportedAt, j.completedAt) : null;
    const back = j.downtimeEnd ?? j.completedAt;
    const repairH = back ? hours(j.reportedAt, back) : null;
    const openR = responseH ?? hours(j.reportedAt, to), openP = repairH ?? hours(j.reportedAt, to);
    const lateR = t.responseHours ? Math.max(0, openR - t.responseHours) : 0;
    const lateP = t.repairHours ? Math.max(0, openP - t.repairHours) : 0;
    return { ...j, responseH, repairH, lateH: Math.max(lateR, lateP), open: !back };
  });
  const periodHours = Math.max(0, hours(from, to));
  let downtimeH = 0;
  for (const j of jobs) {
    if (!j.deviceDown || !j.downtimeStart) continue;
    const a = j.downtimeStart > from ? j.downtimeStart : from, b = end(j.downtimeEnd);
    if (b > a) downtimeH += hours(a, b);
  }
  const uptimePct = devices && periodHours ? Math.max(0, 100 * (1 - downtimeH / (devices * periodHours))) : null;
  // Lateness is charged in the month the job was reported (so an open job isn't charged twice); downtime in every month it falls in.
  const late = rows.filter((r) => r.reportedAt >= from).reduce((s, r) => s + r.lateH, 0);
  const latePenalty = late * (t.penaltyPerLateHour ?? 0);
  const uptimeShort = t.uptimePct != null && uptimePct != null ? Math.max(0, t.uptimePct - uptimePct) : 0;
  const uptimePenalty = uptimeShort * (t.penaltyPerUptimePoint ?? 0);
  const contractH = hours(new Date(`${t.startDate}T00:00:00Z`), new Date(`${t.endDate}T23:59:59Z`));
  const cap = t.penaltyCapPct != null && t.value != null && contractH > 0 ? (t.penaltyCapPct / 100) * t.value * Math.min(1, periodHours / contractH) : null;
  const raw = latePenalty + uptimePenalty;
  return { jobs: rows, devices, periodHours, downtimeH, uptimePct, late, latePenalty, uptimeShort, uptimePenalty, cap,
    penalty: cap != null ? Math.min(raw, cap) : raw, capped: cap != null && raw > cap };
}

/* ── D3: imaging utilisation ── */

export type UsageInput = { exams: number; scheduledHours: number | null; downtimeH: number; capacityPerYear: number | null; months: number };
export type Usage = { exams: number; capacity: number | null; utilisation: number | null; perUptimeHour: number | null; lostExams: number | null };

/**
 * Utilisation is exams against the planning capacity for the months covered. Exams per hour of uptime need the
 * scheduled hours; lost exams are downtime (within the schedule's share of the day) × that rate, or, without a
 * schedule, downtime days × the exams per calendar day.
 */
export function usage(u: UsageInput): Usage {
  const capacity = u.capacityPerYear ? (u.capacityPerYear * u.months) / 12 : null;
  const calendarH = u.months * 730;
  const up = u.scheduledHours != null ? u.scheduledHours - u.downtimeH * (u.scheduledHours / calendarH) : null;
  const perUptimeHour = up && up > 0 ? u.exams / up : null;
  const lostExams = perUptimeHour != null ? u.downtimeH * (u.scheduledHours! / calendarH) * perUptimeHour
    : u.exams > 0 && calendarH > u.downtimeH ? (u.exams / (calendarH - u.downtimeH)) * u.downtimeH : null;
  return { exams: u.exams, capacity, utilisation: capacity ? u.exams / capacity : null, perUptimeHour, lostExams: lostExams != null ? Math.round(lostExams) : null };
}

/** Planning capacities to start from (exams a year per scanner); the hospital replaces them with its own. */
export const CAPACITY_HINTS: Record<string, number> = { "IMG-CT-128": 12000, "IMG-MRI-15T": 6000, "IMG-XR-DR": 15000, "IMG-MAM-DIG": 6000, "IMG-US-GEN": 5000 };

/* ── D4: capital plan ── */

export type PlanInput = { band: "REPLACE" | "PLAN" | "KEEP"; installDate: string | null; lifeYears: number | null; endOfSupport: string | null };

/**
 * The year a device goes in the capital plan: now when it scores "replace now"; within two years when "plan"
 * (sooner if its life ends first); otherwise when its life ends. The maker's end of support brings it forward.
 * Never before this year; null when nothing says when.
 */
export function plannedYear(p: PlanInput, thisYear: number): { year: number | null; why: string } {
  const endLife = p.installDate && p.lifeYears ? Number(p.installDate.slice(0, 4)) + Math.round(p.lifeYears) : null;
  const eos = p.endOfSupport ? Number(p.endOfSupport.slice(0, 4)) : null;
  let year: number | null; let why: string;
  if (p.band === "REPLACE") { year = thisYear; why = "Scores replace now"; }
  else if (p.band === "PLAN") { year = Math.min(endLife ?? thisYear + 2, thisYear + 2); why = endLife != null && endLife < thisYear + 2 ? "Life ends" : "Scores plan replacement"; }
  else { year = endLife; why = "Life ends"; }
  if (eos != null && (year == null || eos < year)) { year = eos; why = "Maker support ends"; }
  if (year != null && year < thisYear) year = thisYear;
  return { year, why };
}

/* ── D5: total cost of ownership ── */

export type TcoInput = {
  capex: number; years: number; warrantyMonths: number | null;
  serviceAnnual: number | null; consumablesAnnual: number | null; energyAnnual: number | null; otherAnnual: number | null;
  uptimePct: number | null; downtimeCostPerDay: number | null;
};
export type Tco = { capex: number; service: number; running: number; downtime: number | null; total: number; serviceYears: number; missing: string[] };

/** Price plus service after the warranty, running costs, and the cost of the downtime its uptime guarantee allows. */
export function tco(i: TcoInput): Tco {
  const serviceYears = Math.max(0, i.years - (i.warrantyMonths ?? 0) / 12);
  const service = (i.serviceAnnual ?? 0) * serviceYears;
  const running = ((i.consumablesAnnual ?? 0) + (i.energyAnnual ?? 0) + (i.otherAnnual ?? 0)) * i.years;
  const downtime = i.uptimePct != null && i.downtimeCostPerDay != null ? ((100 - i.uptimePct) / 100) * 365 * i.years * i.downtimeCostPerDay : null;
  const missing = [i.serviceAnnual == null && serviceYears > 0 && "service", i.consumablesAnnual == null && "consumables", i.energyAnnual == null && "energy", i.uptimePct == null && "uptime"].filter(Boolean) as string[];
  return { capex: i.capex, service, running, downtime, total: i.capex + service + running + (downtime ?? 0), serviceYears, missing };
}

/** Pure calculations behind the reports (unit-tested in calc.test.ts). */
import { addDays, daysBetween, isISODate } from "../assets/dates";
import type { FilterKind, ReportFilters, Row } from "./types";

/* ── Filters ── */

export const DAY_WINDOWS = [30, 60, 90, 180, 365] as const;
export const GRACE_OPTIONS = [0, 3, 7, 14, 30] as const;
export const DEFAULT_WARRANTY_DAYS = 90;
export const DEFAULT_PPM_GRACE_DAYS = 7;

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
function get(p: Params, k: string): string | undefined {
  if (p instanceof URLSearchParams) return p.get(k) ?? undefined;
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
}

/** Read report filters from a query string. Invalid values fall back to the report's defaults. */
export function parseReportFilters(p: Params, defaults: Partial<ReportFilters> = {}): ReportFilters {
  const fac = Number(get(p, "facilityId"));
  const from = get(p, "from");
  const to = get(p, "to");
  const days = Number(get(p, "days"));
  const graceRaw = get(p, "grace");
  const grace = graceRaw === undefined || graceRaw === "" ? NaN : Number(graceRaw);
  const ps = get(p, "status");
  let f: ReportFilters = {
    facilityId: Number.isInteger(fac) && fac > 0 ? fac : null,
    from: from && isISODate(from) ? from : defaults.from ?? null,
    to: to && isISODate(to) ? to : defaults.to ?? null,
    days: Number.isInteger(days) && days > 0 && days <= 3650 ? days : defaults.days ?? DEFAULT_WARRANTY_DAYS,
    grace: Number.isInteger(grace) && grace >= 0 && grace <= 365 ? grace : defaults.grace ?? DEFAULT_PPM_GRACE_DAYS,
    projectStatus: ps === "all" ? "all" : ps === "open" ? "open" : defaults.projectStatus ?? "open",
  };
  if (f.from && f.to && f.from > f.to) f = { ...f, from: f.to, to: f.from }; // swapped dates: be forgiving
  return f;
}

/** Query string for the same filters (used by the export link), only for the filters a report uses. */
export function filtersToQuery(f: ReportFilters, kinds: FilterKind[]): string {
  const q = new URLSearchParams();
  if (kinds.includes("facility") && f.facilityId) q.set("facilityId", String(f.facilityId));
  if (kinds.includes("dateRange")) { if (f.from) q.set("from", f.from); if (f.to) q.set("to", f.to); }
  if (kinds.includes("days")) q.set("days", String(f.days));
  if (kinds.includes("grace")) q.set("grace", String(f.grace));
  if (kinds.includes("projectStatus")) q.set("status", f.projectStatus);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Facilities a report should include: the chosen facility (when the user may see it) or everything in scope.
 * Returns null for "no restriction"; "forbidden" when a facility outside the user's scope was asked for.
 */
export function facilityFilter(facilityId: number | null, scope: number[] | null): number[] | null | "forbidden" {
  if (facilityId != null) {
    if (scope && !scope.includes(facilityId)) return "forbidden";
    return [facilityId];
  }
  return scope;
}

/* ── Purchase orders ── */

/** Whole days a delivery is late on `today` (0 when not late yet, null without an expected date or once fully delivered). */
export function daysLate(expected: string | null | undefined, today: string, fullyDelivered = false): number | null {
  if (!expected || fullyDelivered) return null;
  return Math.max(0, daysBetween(expected, today));
}

/* ── Money ── */

export type Amount = { amount: number; currency: string };

/**
 * Sum amounts in several currencies into EGP with a rate table (EGP per 1 unit). Amounts whose currency has no rate
 * are left out of the total and listed in `missing`.
 */
export function sumToEgp(items: Amount[], rates: Map<string, number | null> | Record<string, number | null>): {
  egp: number; missing: string[]; byCurrency: Record<string, number>;
} {
  const rate = (c: string) => (rates instanceof Map ? rates.get(c) : rates[c]) ?? (c === "EGP" ? 1 : null);
  let egp = 0;
  const missing = new Set<string>();
  const byCurrency: Record<string, number> = {};
  for (const it of items) {
    if (!Number.isFinite(it.amount)) continue;
    byCurrency[it.currency] = round2((byCurrency[it.currency] ?? 0) + it.amount);
    const r = rate(it.currency);
    if (r == null) { if (it.amount !== 0) missing.add(it.currency); continue; }
    egp += it.amount * r;
  }
  return { egp: round2(egp), missing: [...missing].sort(), byCurrency };
}

export function toEgp(amount: number, currency: string | null | undefined, rates: Map<string, number | null>): number | null {
  const c = currency || "EGP";
  const r = c === "EGP" ? 1 : rates.get(c);
  return r == null ? null : round2(amount * r);
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ── PPM compliance ── */

export type PpmOutcome = "ON_TIME" | "LATE" | "OVERDUE" | "PENDING" | "CANCELLED";

/**
 * One scheduled PPM work order, judged on `today`:
 *   ON_TIME  completed no later than scheduled date + grace days
 *   LATE     completed after that
 *   OVERDUE  not completed and today is past scheduled date + grace
 *   PENDING  not completed and still inside its date + grace
 */
export function classifyPpm(e: { status: string; scheduledDate: string; completedDate?: string | null }, today: string, graceDays = 0): PpmOutcome {
  if (e.status === "CANCELLED") return "CANCELLED";
  const deadline = addDays(e.scheduledDate, Math.max(0, graceDays));
  if (e.status === "COMPLETED") {
    const done = e.completedDate ?? e.scheduledDate;
    return done <= deadline ? "ON_TIME" : "LATE";
  }
  return today > deadline ? "OVERDUE" : "PENDING";
}

export type PpmTally = { due: number; onTime: number; late: number; overdue: number; pending: number; unscheduled: number };

export const emptyTally = (): PpmTally => ({ due: 0, onTime: 0, late: 0, overdue: 0, pending: 0, unscheduled: 0 });

export function addOutcome(t: PpmTally, o: PpmOutcome): PpmTally {
  if (o === "CANCELLED") return t;
  t.due++;
  if (o === "ON_TIME") t.onTime++;
  else if (o === "LATE") t.late++;
  else if (o === "OVERDUE") t.overdue++;
  else t.pending++;
  return t;
}

/**
 * Compliance % = completed on time ÷ PPMs that should be done by now (on time + late + overdue + due but never
 * scheduled). PPMs not yet due are left out. null when nothing was due.
 */
export function compliancePct(t: Pick<PpmTally, "onTime" | "late" | "overdue" | "unscheduled">): number | null {
  const denom = t.onTime + t.late + t.overdue + t.unscheduled;
  if (denom === 0) return null;
  return Math.round((t.onTime / denom) * 1000) / 10;
}

export function sumTallies(ts: PpmTally[]): PpmTally {
  const s = emptyTally();
  for (const t of ts) {
    s.due += t.due; s.onTime += t.onTime; s.late += t.late; s.overdue += t.overdue; s.pending += t.pending; s.unscheduled += t.unscheduled;
  }
  return s;
}

/* ── Tenders ── */

export type AwardStage = "NONE" | "AWARDED" | "COMPLAINT_WINDOW" | "ACCEPTANCE_DUE" | "ACCEPTED";

export const AWARD_STAGE_LABELS: Record<AwardStage, string> = {
  NONE: "No award yet",
  AWARDED: "Awarded",
  COMPLAINT_WINDOW: "Complaint window open",
  ACCEPTANCE_DUE: "Acceptance notice due",
  ACCEPTED: "Accepted",
};

/** Where an awarded offer is in the Law 182 art. 39 sequence (approval → complaint window → acceptance notice). */
export function awardStage(o: { status: string; complaintUntil: string | null; acceptedOn: string | null } | null | undefined, today: string): AwardStage {
  if (!o || o.status !== "AWARDED") return "NONE";
  if (o.acceptedOn) return "ACCEPTED";
  if (!o.complaintUntil) return "AWARDED";
  return o.complaintUntil >= today ? "COMPLAINT_WINDOW" : "ACCEPTANCE_DUE";
}

const STAGE_ORDER: AwardStage[] = ["NONE", "AWARDED", "COMPLAINT_WINDOW", "ACCEPTANCE_DUE", "ACCEPTED"];
/** For a project with several awarded lots: the stage of the least advanced award. */
export function leastAdvanced(stages: AwardStage[]): AwardStage {
  const real = stages.filter((s) => s !== "NONE");
  if (!real.length) return "NONE";
  return real.reduce((a, b) => (STAGE_ORDER.indexOf(a) <= STAGE_ORDER.indexOf(b) ? a : b));
}

/** Sum of a numeric key over rows (non-numbers count as 0). */
export function sumKey(rows: Row[], key: string): number {
  return round2(rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0));
}

/** ≥ 90 % good, ≥ 70 % needs attention, below that poor. */
export function complianceTone(v: unknown): "ok" | "warn" | "danger" | null {
  if (typeof v !== "number") return null;
  return v >= 90 ? "ok" : v >= 70 ? "warn" : "danger";
}

/** "1 order", "3 orders". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

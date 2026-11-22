/**
 * Procurement method and tender timetable (wave 37). Pure: safe on server, client and in tests.
 *
 * Methods: Law 182/2018 art. 7 (public tender by default; the others "by a reasoned decision of the competent
 * authority") and art. 65 (framework agreements, with orders called off under them).
 * Minimum days between announcement and bid submission are admin settings (`tenderMinDays`); the defaults below are
 * planning figures to be confirmed by the hospital's legal adviser against the executive regulations.
 */
import { addDaysISO, todayISO } from "../format";
import type { NewNotification } from "../notifications/types";

export const PROCUREMENT_METHODS = [
  "PUBLIC_TENDER", "LIMITED_TENDER", "LOCAL_TENDER", "TWO_STAGE_TENDER",
  "PUBLIC_PRACTICE", "LIMITED_PRACTICE", "DIRECT_AGREEMENT", "FRAMEWORK_CALL_OFF",
] as const;
export type ProcurementMethod = (typeof PROCUREMENT_METHODS)[number];

export const METHOD_LABELS: Record<ProcurementMethod, string> = {
  PUBLIC_TENDER: "Public tender",
  LIMITED_TENDER: "Limited tender",
  LOCAL_TENDER: "Local tender",
  TWO_STAGE_TENDER: "Two-stage tender",
  PUBLIC_PRACTICE: "Public practice (negotiation)",
  LIMITED_PRACTICE: "Limited practice (negotiation)",
  DIRECT_AGREEMENT: "Direct agreement",
  FRAMEWORK_CALL_OFF: "Call-off under a framework agreement",
};

export const METHOD_LAW: Record<ProcurementMethod, string> = {
  PUBLIC_TENDER: "Art. 7: the default method.",
  LIMITED_TENDER: "Art. 7: by a reasoned decision of the competent authority.",
  LOCAL_TENDER: "Art. 7: by a reasoned decision of the competent authority.",
  TWO_STAGE_TENDER: "Art. 7: by a reasoned decision of the competent authority.",
  PUBLIC_PRACTICE: "Art. 7: by a reasoned decision of the competent authority.",
  LIMITED_PRACTICE: "Art. 7: by a reasoned decision of the competent authority.",
  DIRECT_AGREEMENT: "Art. 7: by a reasoned decision of the competent authority, only in the cases the law allows.",
  FRAMEWORK_CALL_OFF: "Art. 65: an order under a framework agreement already concluded.",
};

/** Planning defaults (days from announcement to bid submission). Admins change them in Settings. */
export const DEFAULT_MIN_DAYS: Record<ProcurementMethod, number> = {
  PUBLIC_TENDER: 30,
  LIMITED_TENDER: 15,
  LOCAL_TENDER: 15,
  TWO_STAGE_TENDER: 30,
  PUBLIC_PRACTICE: 15,
  LIMITED_PRACTICE: 7,
  DIRECT_AGREEMENT: 0,
  FRAMEWORK_CALL_OFF: 0,
};

export function isMethod(v: unknown): v is ProcurementMethod {
  return typeof v === "string" && (PROCUREMENT_METHODS as readonly string[]).includes(v);
}

/** Not set = public tender, the law's default. */
export function methodOf(v: string | null | undefined): ProcurementMethod {
  return isMethod(v) ? v : "PUBLIC_TENDER";
}

/** Every method other than a public tender needs a reasoned decision (art. 7). */
export function needsJustification(m: ProcurementMethod): boolean {
  return m !== "PUBLIC_TENDER";
}

/** The stored setting, read defensively: unknown keys dropped, bad values fall back to the default. */
export function cleanMinDays(v: unknown): Record<ProcurementMethod, number> {
  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = { ...DEFAULT_MIN_DAYS };
  for (const m of PROCUREMENT_METHODS) {
    const n = Number(src[m]);
    if (src[m] != null && src[m] !== "" && Number.isFinite(n) && n >= 0 && n <= 365) out[m] = Math.round(n);
  }
  return out;
}

/* ── Timetable steps ── */

export const TIMETABLE_STEPS = [
  "ANNOUNCEMENT", "CLARIFICATION_DEADLINE", "SUBMISSION", "TECHNICAL_OPENING",
  "FINANCIAL_OPENING", "AWARD_DECISION", "STANDSTILL_END", "CONTRACT_SIGNATURE",
] as const;
export type TimetableStep = (typeof TIMETABLE_STEPS)[number];

export const STEP_LABELS: Record<TimetableStep, string> = {
  ANNOUNCEMENT: "Announcement or invitation",
  CLARIFICATION_DEADLINE: "Last day for questions",
  SUBMISSION: "Bid submission",
  TECHNICAL_OPENING: "Technical opening",
  FINANCIAL_OPENING: "Financial opening",
  AWARD_DECISION: "Award decision",
  STANDSTILL_END: "Complaint period ends",
  CONTRACT_SIGNATURE: "Contract signed",
};

/** Where the app finds a real date for the step, if it has one (shown beside the step). */
export const STEP_SOURCE: Partial<Record<TimetableStep, string>> = {
  ANNOUNCEMENT: "first RFQ issue date",
  SUBMISSION: "RFQ closing date, once passed",
  TECHNICAL_OPENING: "technical envelopes opened",
  FINANCIAL_OPENING: "financial envelopes opened",
  AWARD_DECISION: "award approved by the competent authority",
  STANDSTILL_END: "award complaint period, once passed",
  CONTRACT_SIGNATURE: "first purchase order issued",
};

export function isStep(v: unknown): v is TimetableStep {
  return typeof v === "string" && (TIMETABLE_STEPS as readonly string[]).includes(v);
}

/** Steps that apply: the financial opening only in a two-envelope tender. */
export function stepsFor(twoEnvelope: boolean): TimetableStep[] {
  return TIMETABLE_STEPS.filter((s) => twoEnvelope || s !== "FINANCIAL_OPENING");
}

/** Art. 19: answers and amendments must reach bidders at least 7 days before the technical opening. */
export const ANSWER_LEAD_DAYS = 7;
/** Planning gaps used only to suggest blank planned dates (not law). */
export const PLAN_GAPS = { financialAfterTechnical: 14, awardAfterOpening: 21, contractAfterStandstill: 10 } as const;

export type Plan = Partial<Record<TimetableStep, string | null>>;

const days = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);

/**
 * Suggested planned dates from an announcement date. Only steps left blank in `current` are filled; a date already
 * there is kept and later suggestions follow from it.
 */
export function suggestPlan(o: {
  announcement: string; method: ProcurementMethod; minDays: Record<ProcurementMethod, number>;
  complaintDays: number; twoEnvelope: boolean; current?: Plan;
}): Record<TimetableStep, string | null> {
  const cur = o.current ?? {};
  const pick = (s: TimetableStep, fallback: string) => cur[s] || fallback;
  const announcement = pick("ANNOUNCEMENT", o.announcement);
  const submission = pick("SUBMISSION", addDaysISO(announcement, o.minDays[o.method]));
  const technical = pick("TECHNICAL_OPENING", submission);
  const clarLatest = addDaysISO(technical, -ANSWER_LEAD_DAYS);
  const clarification = pick("CLARIFICATION_DEADLINE", clarLatest < announcement ? announcement : clarLatest);
  const financial = o.twoEnvelope ? pick("FINANCIAL_OPENING", addDaysISO(technical, PLAN_GAPS.financialAfterTechnical)) : null;
  const award = pick("AWARD_DECISION", addDaysISO(financial ?? technical, PLAN_GAPS.awardAfterOpening));
  const standstill = pick("STANDSTILL_END", addDaysISO(award, o.complaintDays));
  const contract = pick("CONTRACT_SIGNATURE", addDaysISO(standstill, PLAN_GAPS.contractAfterStandstill));
  return {
    ANNOUNCEMENT: announcement, CLARIFICATION_DEADLINE: clarification, SUBMISSION: submission, TECHNICAL_OPENING: technical,
    FINANCIAL_OPENING: financial, AWARD_DECISION: award, STANDSTILL_END: standstill, CONTRACT_SIGNATURE: contract,
  };
}

export type PlanProblem = { step: TimetableStep; text: string };

/** Problems with the planned dates: below the minimum period, out of order, too little time for answers or complaints. */
export function checkPlan(plan: Plan, o: {
  method: ProcurementMethod; minDays: Record<ProcurementMethod, number>; complaintDays: number; twoEnvelope: boolean;
}): PlanProblem[] {
  const out: PlanProblem[] = [];
  const steps = stepsFor(o.twoEnvelope);
  // Order: each planned step on or after the last planned step before it.
  let prev: TimetableStep | null = null;
  for (const s of steps) {
    const d = plan[s];
    if (!d) continue;
    if (prev && d < plan[prev]!) out.push({ step: s, text: `Planned before the ${STEP_LABELS[prev].toLowerCase()}.` });
    prev = s;
  }
  const a = plan.ANNOUNCEMENT, sub = plan.SUBMISSION, tech = plan.TECHNICAL_OPENING, clar = plan.CLARIFICATION_DEADLINE;
  const min = o.minDays[o.method];
  if (a && sub && days(a, sub) < min) {
    out.push({ step: "SUBMISSION", text: `Only ${days(a, sub)} days after the announcement. The minimum for a ${METHOD_LABELS[o.method].toLowerCase()} is ${min} days.` });
  }
  if (clar && tech && days(clar, tech) < ANSWER_LEAD_DAYS) {
    out.push({ step: "CLARIFICATION_DEADLINE", text: `Less than ${ANSWER_LEAD_DAYS} days before the technical opening: answers and amendments must reach bidders at least ${ANSWER_LEAD_DAYS} days before it (art. 19).` });
  }
  if (plan.AWARD_DECISION && plan.STANDSTILL_END && days(plan.AWARD_DECISION, plan.STANDSTILL_END) < o.complaintDays) {
    out.push({ step: "STANDSTILL_END", text: `Shorter than the ${o.complaintDays}-day complaint period after the award (art. 39).` });
  }
  return out;
}

/* ── Actual dates the app already has ── */

export type KnownDates = {
  technicalOpenedAt: Date | string | null;
  financialOpenedAt: Date | string | null;
  rfqs: { status: string; issueDate: string | null; closingDate: string | null }[];
  awards: { awardApprovedOn: string | null; complaintUntil: string | null }[];
  pos: { status: string; issueDate: string | null }[];
};

const LIVE_RFQ = new Set(["ISSUED", "CLOSED"]);
const PO_NOT_SENT = new Set(["DRAFT", "PENDING_APPROVAL", "APPROVED", "CANCELLED"]);
const min = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort()[0] ?? null;
const max = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
const dayOf = (v: Date | string | null) => (v == null ? null : todayISO(typeof v === "string" ? new Date(v) : v));

/** Actual dates taken from the tender's own records (Cairo dates). Missing = the app doesn't know yet. */
export function knownActuals(k: KnownDates, today: string): Plan {
  const live = k.rfqs.filter((r) => LIVE_RFQ.has(r.status));
  const closing = max(live.map((r) => r.closingDate));
  const out: Plan = {
    ANNOUNCEMENT: min(live.map((r) => r.issueDate)),
    SUBMISSION: closing && closing <= today ? closing : null,
    TECHNICAL_OPENING: dayOf(k.technicalOpenedAt),
    FINANCIAL_OPENING: dayOf(k.financialOpenedAt),
    AWARD_DECISION: min(k.awards.map((a) => a.awardApprovedOn)),
    STANDSTILL_END: min(k.awards.map((a) => (a.complaintUntil && a.complaintUntil < today ? a.complaintUntil : null))),
    CONTRACT_SIGNATURE: min(k.pos.filter((p) => !PO_NOT_SENT.has(p.status)).map((p) => p.issueDate)),
  };
  for (const s of TIMETABLE_STEPS) if (!out[s]) delete out[s];
  return out;
}

/** The app's date wins over one typed by hand, so the same date is never asked twice. */
export function actualFor(step: TimetableStep, entered: string | null | undefined, known: Plan): { date: string | null; fromApp: boolean } {
  if (known[step]) return { date: known[step]!, fromApp: true };
  return { date: entered || null, fromApp: false };
}

export type StepState =
  | { kind: "on_time" } | { kind: "late"; days: number } | { kind: "done" }
  | { kind: "overdue"; days: number } | { kind: "due_today" } | { kind: "upcoming"; days: number } | { kind: "not_planned" };

export function stepState(planned: string | null | undefined, actual: string | null | undefined, today: string): StepState {
  if (actual) {
    if (!planned) return { kind: "done" };
    const late = days(planned, actual);
    return late > 0 ? { kind: "late", days: late } : { kind: "on_time" };
  }
  if (!planned) return { kind: "not_planned" };
  const left = days(today, planned);
  if (left < 0) return { kind: "overdue", days: -left };
  if (left === 0) return { kind: "due_today" };
  return { kind: "upcoming", days: left };
}

export function stateLabel(s: StepState): { text: string; tone: "ok" | "warn" | "danger" | "info" | "neutral" } {
  switch (s.kind) {
    case "on_time": return { text: "On time", tone: "ok" };
    case "done": return { text: "Done", tone: "ok" };
    case "late": return { text: `Late by ${s.days} day${s.days === 1 ? "" : "s"}`, tone: "warn" };
    case "overdue": return { text: `Overdue by ${s.days} day${s.days === 1 ? "" : "s"}`, tone: "danger" };
    case "due_today": return { text: "Due today", tone: "warn" };
    case "upcoming": return { text: `In ${s.days} day${s.days === 1 ? "" : "s"}`, tone: "info" };
    default: return { text: "Not planned", tone: "neutral" };
  }
}

/* ── Alerts ── */

export type OverdueStepRow = {
  projectId: number; code: string; facilityId: number | null; twoEnvelope: boolean;
  step: string; plannedDate: string; actualDate: string | null;
};

/**
 * Overdue planned steps (no actual date, planned before today), one alert per project, step and planned date.
 * `known` gives the app's actual dates per project, so a step the app has recorded never alerts.
 */
export function overdueStepAlerts(rows: OverdueStepRow[], known: Map<number, Plan>, today: string): { facilityId: number | null; n: NewNotification }[] {
  const out: { facilityId: number | null; n: NewNotification }[] = [];
  for (const r of rows) {
    if (!isStep(r.step) || !stepsFor(r.twoEnvelope).includes(r.step)) continue;
    const actual = actualFor(r.step, r.actualDate, known.get(r.projectId) ?? {}).date;
    const st = stepState(r.plannedDate, actual, today);
    if (st.kind !== "overdue") continue;
    out.push({
      facilityId: r.facilityId,
      n: {
        kind: "tender_step_overdue",
        title: `${r.code}: ${STEP_LABELS[r.step].toLowerCase()} is overdue`,
        body: `Planned for ${r.plannedDate}, ${st.days} day${st.days === 1 ? "" : "s"} ago, and no actual date is recorded. Record the date or move the plan.`,
        href: `/procurement/${r.projectId}?tab=tender`,
        dedupeKey: `tender_step_overdue:${r.projectId}:${r.step}:${r.plannedDate}`,
      },
    });
  }
  return out;
}

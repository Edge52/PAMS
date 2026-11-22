import "server-only";
/** Tender timetable loading (wave 37). Rules are pure in ./timetable.ts. */
import { and, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { offers, projects, purchaseOrders, rfqs, tenderClarifications, tenderTimetableSteps } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import {
  actualFor, checkPlan, cleanMinDays, knownActuals, methodOf, overdueStepAlerts, stepsFor, stepState,
  type Plan, type PlanProblem, type ProcurementMethod, type StepState, type TimetableStep,
} from "./timetable";
import { registerCounts } from "./clarifications";

/** The actual dates the app already holds, per project. */
export async function knownActualsFor(projectIds: number[], today: string): Promise<Map<number, Plan>> {
  const out = new Map<number, Plan>();
  if (!projectIds.length) return out;
  const [ps, rs, os, pos] = await Promise.all([
    db.select({ id: projects.id, t: projects.technicalOpenedAt, f: projects.financialOpenedAt }).from(projects).where(inArray(projects.id, projectIds)),
    db.select({ projectId: rfqs.projectId, status: rfqs.status, issueDate: rfqs.issueDate, closingDate: rfqs.closingDate }).from(rfqs).where(inArray(rfqs.projectId, projectIds)),
    db.select({ projectId: offers.projectId, awardApprovedOn: offers.awardApprovedOn, complaintUntil: offers.complaintUntil }).from(offers)
      .where(and(inArray(offers.projectId, projectIds), eq(offers.status, "AWARDED"))),
    db.select({ projectId: purchaseOrders.projectId, status: purchaseOrders.status, issueDate: purchaseOrders.issueDate }).from(purchaseOrders)
      .where(inArray(purchaseOrders.projectId, projectIds)),
  ]);
  for (const p of ps) {
    out.set(p.id, knownActuals({
      technicalOpenedAt: p.t, financialOpenedAt: p.f,
      rfqs: rs.filter((r) => r.projectId === p.id), awards: os.filter((o) => o.projectId === p.id), pos: pos.filter((o) => o.projectId === p.id),
    }, today));
  }
  return out;
}

export type TimetableRow = {
  step: TimetableStep; planned: string | null; actual: string | null; fromApp: boolean; entered: string | null;
  notes: string | null; state: StepState; problems: string[];
};

export type Timetable = {
  method: ProcurementMethod; minDays: Record<ProcurementMethod, number>; complaintDays: number;
  rows: TimetableRow[]; problems: PlanProblem[];
};

export async function loadTimetable(p: { id: number; procurementMethod: string | null; twoEnvelope: boolean }, today: string): Promise<Timetable> {
  const [s, stored, known] = await Promise.all([
    getSettings(),
    db.select().from(tenderTimetableSteps).where(eq(tenderTimetableSteps.projectId, p.id)),
    knownActualsFor([p.id], today),
  ]);
  const method = methodOf(p.procurementMethod);
  const minDays = cleanMinDays(s.tenderMinDays);
  const k = known.get(p.id) ?? {};
  const by = new Map(stored.map((r) => [r.step, r]));
  const plan: Plan = Object.fromEntries(stored.map((r) => [r.step, r.plannedDate]));
  const problems = checkPlan(plan, { method, minDays, complaintDays: s.complaintDays, twoEnvelope: p.twoEnvelope });
  const rows = stepsFor(p.twoEnvelope).map((step): TimetableRow => {
    const r = by.get(step);
    const a = actualFor(step, r?.actualDate, k);
    return {
      step, planned: r?.plannedDate ?? null, actual: a.date, fromApp: a.fromApp, entered: r?.actualDate ?? null, notes: r?.notes ?? null,
      state: stepState(r?.plannedDate, a.date, today), problems: problems.filter((x) => x.step === step).map((x) => x.text),
    };
  });
  return { method, minDays, complaintDays: s.complaintDays, rows, problems };
}

/** Clarification counts for a project (all its RFQs): questions and those still without an answer sent. */
export async function projectClarificationCounts(projectId: number) {
  const rows = await db.select({ answer: tenderClarifications.answer, sentOn: tenderClarifications.sentOn }).from(tenderClarifications)
    .innerJoin(rfqs, eq(rfqs.id, tenderClarifications.rfqId)).where(eq(rfqs.projectId, projectId));
  return registerCounts(rows);
}

/** Overdue timetable steps for the hourly alerts (open projects only). */
export async function overdueTimetableAlerts(today: string) {
  const rows = await db.select({
    projectId: projects.id, code: projects.code, facilityId: projects.facilityId, twoEnvelope: projects.twoEnvelope,
    step: tenderTimetableSteps.step, plannedDate: tenderTimetableSteps.plannedDate, actualDate: tenderTimetableSteps.actualDate,
  }).from(tenderTimetableSteps).innerJoin(projects, eq(projects.id, tenderTimetableSteps.projectId))
    .where(and(lt(tenderTimetableSteps.plannedDate, today), isNull(tenderTimetableSteps.actualDate), notInArray(projects.status, ["CLOSED", "CANCELLED"])));
  const list = rows.filter((r): r is typeof r & { plannedDate: string } => r.plannedDate != null);
  const known = await knownActualsFor([...new Set(list.map((r) => r.projectId))], today);
  return overdueStepAlerts(list, known, today);
}

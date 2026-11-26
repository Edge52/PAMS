"use server";
/**
 * Procurement method and tender timetable (wave 37, Law 182/2018 art. 7, 19, 39). Rules are pure in
 * src/lib/procurement/timetable.ts.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { projectLawTerms, projects, tenderTimetableSteps } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formatDate, todayISO } from "@/lib/format";
import { fail, formObject, idParam, optStr, type ActionState, zodFail } from "@/lib/procurement/forms";
import { knownActualsFor, lawTermsFor } from "@/lib/procurement/timetable-server";
import {
  checkPlan, cleanMinDays, legalMinDays, METHOD_LABELS, methodOf, needsJustification, PROCUREMENT_METHODS, STEP_LABELS, stepsFor, suggestPlan,
  urgentProblem, type Plan,
} from "@/lib/procurement/timetable";
import { logActivity } from "@/lib/server-utils";
import { getSettings } from "@/lib/settings";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const path = (id: number) => `/procurement/${id}`;

async function projectFor(fd: FormData) {
  const me = await requirePermission("procurement.edit");
  const id = Number(fd.get("projectId"));
  const [p] = Number.isInteger(id) && id > 0 ? await db.select().from(projects).where(eq(projects.id, id)) : [];
  if (p) await requireFacilityAccess(p.facilityId, me);
  return { me, p };
}

export async function saveMethodAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { me, p } = await projectFor(fd);
  if (!p) return fail("This project no longer exists.");
  const parsed = z.object({
    projectId: idParam("Project missing"),
    method: z.enum(PROCUREMENT_METHODS, { error: "Choose the procurement method" }),
    justification: optStr(4000),
    approvingAuthority: optStr(300),
    urgentReason: optStr(2000),
  }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const d = parsed.data;
  if (needsJustification(d.method) && !d.justification?.trim()) {
    return { errors: ["Give the reason for not using a public tender (Law 182/2018 art. 7 asks for a reasoned decision)."], fields: { justification: "Give the reason for this method." } };
  }
  // Wave 39: urgent tender, with its reason, for the shorter legal minimum days.
  const urgent = fd.get("urgent") === "on";
  const urgentReason = d.urgentReason?.trim() || null;
  const uProblem = urgentProblem(urgent, urgentReason);
  if (uProblem) return { errors: [uProblem], fields: { urgentReason: uProblem } };
  const before = methodOf(p.procurementMethod);
  const law = await lawTermsFor(p.id);
  await db.transaction(async (tx) => {
    await tx.update(projects).set({
      procurementMethod: d.method, methodJustification: d.justification?.trim() || null, approvingAuthority: d.approvingAuthority?.trim() || null,
    }).where(eq(projects.id, p.id));
    const set = { urgent, urgentReason: urgent ? urgentReason : null };
    await tx.insert(projectLawTerms).values({ projectId: p.id, ...set }).onConflictDoUpdate({ target: projectLawTerms.projectId, set });
    const what = before !== d.method || !p.procurementMethod ? `Method set to ${METHOD_LABELS[d.method].toLowerCase()}` : "Method details updated";
    const urgency = urgent !== law.urgent ? (urgent ? `; marked urgent (${legalMinDays(d.method, true)} days minimum): ${urgentReason}` : "; no longer urgent") : "";
    await logActivity("project", p.id, "method", `${what}${d.approvingAuthority ? `, approved by ${d.approvingAuthority}` : ""}${urgency}`, me.name, tx);
  });
  revalidatePath(path(p.id));
  return { message: "Method saved." };
}

export async function saveTimetableAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { me, p } = await projectFor(fd);
  if (!p) return fail("This project no longer exists.");
  const steps = stepsFor(p.twoEnvelope);
  const fields: Record<string, string> = {};
  const values = steps.map((step) => {
    const planned = String(fd.get(`planned_${step}`) ?? "").trim();
    const actual = String(fd.get(`actual_${step}`) ?? "").trim();
    const notes = String(fd.get(`notes_${step}`) ?? "").trim().slice(0, 500);
    if (planned && !DATE.test(planned)) fields[`planned_${step}`] = "Enter a date.";
    if (actual && !DATE.test(actual)) fields[`actual_${step}`] = "Enter a date.";
    return { step, planned: planned || null, actual: actual || null, notes: notes || null };
  });
  if (Object.keys(fields).length) return { errors: ["Some dates are not valid dates."], fields };
  const today = todayISO();
  const future = values.find((v) => v.actual && v.actual > today);
  if (future) return { errors: [`The actual date for ${STEP_LABELS[future.step].toLowerCase()} is in the future.`], fields: { [`actual_${future.step}`]: "Can't be after today." } };
  // Steps the app already knows keep the app's date: a typed actual date for them is not stored.
  const known = (await knownActualsFor([p.id], today)).get(p.id) ?? {};
  const [s, law] = await Promise.all([getSettings(), lawTermsFor(p.id)]);
  await db.transaction(async (tx) => {
    for (const v of values) {
      const actual = known[v.step] ? null : v.actual;
      await tx.insert(tenderTimetableSteps).values({ projectId: p.id, step: v.step, plannedDate: v.planned, actualDate: actual, notes: v.notes })
        .onConflictDoUpdate({ target: [tenderTimetableSteps.projectId, tenderTimetableSteps.step], set: { plannedDate: v.planned, actualDate: actual, notes: v.notes } });
    }
    await logActivity("project", p.id, "timetable", "Tender timetable updated", me.name, tx);
  });
  const plan: Plan = Object.fromEntries(values.map((v) => [v.step, v.planned]));
  const problems = checkPlan(plan, { method: methodOf(p.procurementMethod), minDays: cleanMinDays(s.tenderMinDays), complaintDays: s.complaintDays, twoEnvelope: p.twoEnvelope, urgent: law.urgent });
  revalidatePath(path(p.id));
  return { message: problems.length ? `Timetable saved, with ${problems.length} thing${problems.length === 1 ? "" : "s"} to check (marked below).` : "Timetable saved." };
}

/** Fill blank planned dates from the announcement date (planned, else the app's actual, else today). */
export async function suggestDatesAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const { me, p } = await projectFor(fd);
  if (!p) return fail("This project no longer exists.");
  const today = todayISO();
  const [stored, known, s, law] = await Promise.all([
    db.select().from(tenderTimetableSteps).where(eq(tenderTimetableSteps.projectId, p.id)),
    knownActualsFor([p.id], today),
    getSettings(),
    lawTermsFor(p.id),
  ]);
  const current: Plan = Object.fromEntries(stored.map((r) => [r.step, r.plannedDate]));
  const announcement = current.ANNOUNCEMENT || known.get(p.id)?.ANNOUNCEMENT || today;
  const plan = suggestPlan({ announcement, method: methodOf(p.procurementMethod), minDays: cleanMinDays(s.tenderMinDays), complaintDays: s.complaintDays, twoEnvelope: p.twoEnvelope, current, urgent: law.urgent });
  const filled = stepsFor(p.twoEnvelope).filter((step) => !current[step] && plan[step]);
  if (!filled.length) return { message: "Every step already has a planned date." };
  await db.transaction(async (tx) => {
    for (const step of filled) {
      await tx.insert(tenderTimetableSteps).values({ projectId: p.id, step, plannedDate: plan[step] })
        .onConflictDoUpdate({ target: [tenderTimetableSteps.projectId, tenderTimetableSteps.step], set: { plannedDate: plan[step] } });
    }
    await logActivity("project", p.id, "timetable", `Planned dates suggested for ${filled.length} step${filled.length === 1 ? "" : "s"} from the announcement on ${formatDate(announcement)}`, me.name, tx);
  });
  revalidatePath(path(p.id));
  return { message: `Filled ${filled.length} planned date${filled.length === 1 ? "" : "s"}. Check them and save any changes.` };
}

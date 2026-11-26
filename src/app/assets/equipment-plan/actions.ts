"use server";
/**
 * Medical equipment management plan (wave 40, GAHAR 2025 standards EFS.10 EOC 1). Biomedical engineering writes and
 * reviews it (`assets.edit`); approval goes through the approvals engine as entity EQUIPMENT_PLAN (default rule:
 * hospital director), whose effect sets the plan APPROVED.
 */
import { and, desc, eq, max } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { equipmentPlanReviews, equipmentPlans, facilities } from "@/db/schema";
import { cancelApproval, startApproval } from "@/lib/approvals/server";
import { requireFacilityAccess, requirePermission, type CurrentUser } from "@/lib/auth/session";
import { formObject, int, isoDate, reqId, reqText, text } from "@/lib/assets/forms";
import { defaultKpis, kpiSnapshot, kpisFromForm, PLAN_TEMPLATE } from "@/lib/compliance/equipment-plan";
import { planKpiValues } from "@/lib/compliance/gahar-server";
import { zodFail, type ActionState } from "@/lib/procurement/forms";
import { diff } from "@/lib/audit-diff";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const path = (id: number) => `/assets/equipment-plan/${id}`;
const go = (id: number, msg: string): never => redirect(`${path(id)}?notice=${encodeURIComponent(msg)}`);

async function load(planId: unknown, me: CurrentUser) {
  const pid = Number(planId);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const [p] = await db.select().from(equipmentPlans).where(eq(equipmentPlans.id, pid));
  if (!p) return null;
  await requireFacilityAccess(p.facilityId, me);
  return p;
}

const NewSchema = z.object({ facilityId: reqId("Hospital"), year: int("Year", 2000, 2100) });

/** A new plan for a year: a copy of the hospital's latest plan when there is one, else the starting text. */
export async function createPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = NewSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const { facilityId } = p.data;
  const year = p.data.year ?? Number(todayISO().slice(0, 4));
  await requireFacilityAccess(facilityId, me);
  const [last] = await db.select().from(equipmentPlans).where(eq(equipmentPlans.facilityId, facilityId)).orderBy(desc(equipmentPlans.year), desc(equipmentPlans.version)).limit(1);
  const [{ v }] = await db.select({ v: max(equipmentPlans.version) }).from(equipmentPlans).where(and(eq(equipmentPlans.facilityId, facilityId), eq(equipmentPlans.year, year)));
  const [row] = await db.insert(equipmentPlans).values({
    facilityId, year, version: (v ?? 0) + 1,
    scope: last?.scope ?? PLAN_TEMPLATE.scope, riskMethod: last?.riskMethod ?? PLAN_TEMPLATE.riskMethod,
    maintenanceStrategy: last?.maintenanceStrategy ?? PLAN_TEMPLATE.maintenanceStrategy, kpis: last?.kpis?.length ? last.kpis : defaultKpis(), notes: last?.notes ?? null,
    createdById: me.id, createdByName: me.name,
  }).returning({ id: equipmentPlans.id, version: equipmentPlans.version });
  await logActivity("equipment_plan", row.id, "created", `Plan ${year} v${row.version} started${last ? ` from ${last.year} v${last.version}` : ""}`, me.name);
  revalidatePath("/assets/equipment-plan");
  return go(row.id, "Draft plan created. Check each part, then submit it for approval.");
}

const EditSchema = z.object({
  planId: reqId("Plan"), scope: reqText("Scope", 5000), riskMethod: reqText("Risk method", 5000),
  maintenanceStrategy: reqText("Maintenance strategy", 5000), notes: text(5000),
});

export async function savePlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = EditSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const plan = await load(p.data.planId, me);
  if (!plan) return { errors: ["That plan no longer exists."] };
  if (plan.status !== "DRAFT") return { errors: ["Only a draft can be changed. Start a new version to change an approved plan."] };
  const k = kpisFromForm((n) => { const v = fd.get(n); return typeof v === "string" ? v : null; });
  if ("error" in k) return { errors: [k.error], fields: { [k.field]: k.error } };
  const next = { scope: p.data.scope, riskMethod: p.data.riskMethod, maintenanceStrategy: p.data.maintenanceStrategy, notes: p.data.notes ?? null, kpis: k.kpis };
  const changes = diff(plan, next, ["scope", "riskMethod", "maintenanceStrategy", "notes", "kpis"]);
  await db.update(equipmentPlans).set(next).where(eq(equipmentPlans.id, plan.id));
  await logActivity("equipment_plan", plan.id, "updated", `Plan ${plan.year} v${plan.version} saved`, me.name, undefined, changes);
  revalidatePath(path(plan.id));
  return { message: "Saved." };
}

export async function submitPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const plan = await load(fd.get("planId"), me);
  if (!plan) return { errors: ["That plan no longer exists."] };
  if (plan.status !== "DRAFT") return { errors: ["This plan was already submitted."] };
  if (!plan.kpis.length) return { errors: ["Add at least one KPI first."] };
  const [fac] = await db.select({ code: facilities.code }).from(facilities).where(eq(facilities.id, plan.facilityId));
  await db.update(equipmentPlans).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(equipmentPlans.id, plan.id));
  let auto = false;
  try {
    const res = await startApproval({ entity: "EQUIPMENT_PLAN", entityId: plan.id, title: `Equipment management plan ${plan.year} v${plan.version} (${fac?.code ?? ""})`, href: path(plan.id), facilityId: plan.facilityId }, me);
    auto = res.status === "APPROVED";
  } catch (e) {
    await db.update(equipmentPlans).set({ status: "DRAFT", submittedAt: null }).where(eq(equipmentPlans.id, plan.id));
    return { errors: [e instanceof Error ? e.message : "Could not start the approval."] };
  }
  revalidatePath(path(plan.id));
  revalidatePath("/approvals");
  return go(plan.id, auto ? "Approved at once: no approval rule applies." : "Submitted. The approvers have been notified.");
}

export async function withdrawPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const plan = await load(fd.get("planId"), me);
  if (!plan) return { errors: ["That plan no longer exists."] };
  if (plan.status !== "SUBMITTED") return { errors: ["Only a plan waiting for approval can be withdrawn."] };
  const ok = await cancelApproval("EQUIPMENT_PLAN", plan.id, "withdrawn by biomedical engineering", me);
  if (!ok) await db.update(equipmentPlans).set({ status: "DRAFT" }).where(eq(equipmentPlans.id, plan.id));
  revalidatePath(path(plan.id));
  revalidatePath("/approvals");
  return go(plan.id, "Withdrawn. It is a draft again.");
}

/** A new draft version of an approved plan (same year), to update it after the evaluation. */
export async function newPlanVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const plan = await load(fd.get("planId"), me);
  if (!plan) return { errors: ["That plan no longer exists."] };
  const [{ v }] = await db.select({ v: max(equipmentPlans.version) }).from(equipmentPlans).where(and(eq(equipmentPlans.facilityId, plan.facilityId), eq(equipmentPlans.year, plan.year)));
  const [row] = await db.insert(equipmentPlans).values({
    facilityId: plan.facilityId, year: plan.year, version: (v ?? plan.version) + 1, scope: plan.scope, riskMethod: plan.riskMethod,
    maintenanceStrategy: plan.maintenanceStrategy, kpis: plan.kpis, notes: plan.notes, createdById: me.id, createdByName: me.name,
  }).returning({ id: equipmentPlans.id, version: equipmentPlans.version });
  await logActivity("equipment_plan", row.id, "created", `Plan ${plan.year} v${row.version} started from v${plan.version}`, me.name);
  revalidatePath("/assets/equipment-plan");
  return go(row.id, `Version ${row.version} created as a draft.`);
}

const ReviewSchema = z.object({ planId: reqId("Plan"), periodFrom: isoDate("Start of the period"), periodTo: isoDate("End of the period"), findings: text(10000), actions: text(10000) });

/** The yearly evaluation: the KPI figures are worked out now and kept with the review. */
export async function addPlanReviewAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = ReviewSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const plan = await load(p.data.planId, me);
  if (!plan) return { errors: ["That plan no longer exists."] };
  const today = todayISO();
  const from = p.data.periodFrom, to = p.data.periodTo;
  if (!from) return { errors: ["Enter the start of the period."], fields: { periodFrom: "Enter a date." } };
  if (!to) return { errors: ["Enter the end of the period."], fields: { periodTo: "Enter a date." } };
  if (to < from) return { errors: ["The period ends before it starts."], fields: { periodTo: "Before the start." } };
  if (to > today) return { errors: ["The period can't end in the future."], fields: { periodTo: "In the future." } };
  if (!p.data.findings && !p.data.actions) return { errors: ["Write the findings or the actions agreed."], fields: { findings: "Write what the evaluation found." } };
  const snapshot = kpiSnapshot(plan.kpis, await planKpiValues(plan.facilityId, from, to, today));
  const [row] = await db.insert(equipmentPlanReviews).values({
    planId: plan.id, periodFrom: from, periodTo: to, kpiSnapshot: snapshot, findings: p.data.findings ?? null, actions: p.data.actions ?? null,
    reviewedById: me.id, reviewedByName: me.name,
  }).returning({ id: equipmentPlanReviews.id });
  const met = snapshot.filter((s) => s.met).length;
  await logActivity("equipment_plan", plan.id, "reviewed", `Evaluation ${from} to ${to}: ${met} of ${snapshot.length} KPIs met (review ${row.id})`, me.name);
  revalidatePath(path(plan.id));
  return go(plan.id, `Evaluation recorded: ${met} of ${snapshot.length} KPIs met.`);
}

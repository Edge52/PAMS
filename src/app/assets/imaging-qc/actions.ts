"use server";
/**
 * Routine imaging QC (wave 40, GAHAR DAS.05). Technologists record runs (`workorders.report`: anyone signed in, like a
 * fault report, with access to the hospital); templates are kept by biomedical (`catalogue.edit`); the monthly review
 * is signed by the responsible radiologist or physicist (biomedical `incidents.manage`, or the department's head).
 * The physicist's yearly QC stays on Radiation safety. Rules: src/lib/assets/imaging-qc.ts.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, imagingQcRecords, imagingQcReviews, imagingQcTemplates, workOrders } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { myDepartments } from "@/lib/auth/departments";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, isoDate, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import {
  EXAMPLE_TEMPLATES, failureTitle, FREQUENCIES, judgeRun, MODALITIES, modalityOf, parseItems, REVIEWER_ROLES, reviewMonths,
} from "@/lib/assets/imaging-qc";
import { qcMonth } from "@/lib/assets/imaging-qc-server";
import { applyAssetEffect, coverForAsset, notifyAssigners } from "@/lib/assets/work-order-server";
import { responseDue } from "@/lib/assets/work-orders";
import { quarantineFor } from "@/lib/assets/vigilance-server";
import { todayISO } from "@/lib/format";
import { logActivity, nextNumber } from "@/lib/server-utils";

const page = (facilityId: number, tab: string, extra = "") => `/assets/imaging-qc?facilityId=${facilityId}&tab=${tab}${extra}`;
const go = (to: string, msg: string, kind: "notice" | "error" = "notice"): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);

/* ── Templates ── */

export async function addExampleTemplatesAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const facilityId = Number(fd.get("facilityId"));
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose a hospital." };
  await requireFacilityAccess(facilityId, me);
  const have = new Set((await db.select({ name: imagingQcTemplates.name }).from(imagingQcTemplates).where(eq(imagingQcTemplates.facilityId, facilityId))).map((t) => t.name));
  const add = EXAMPLE_TEMPLATES.filter((t) => !have.has(t.name));
  if (!add.length) return { error: "The example templates are already there." };
  await db.insert(imagingQcTemplates).values(add.map((t) => ({ facilityId, modality: t.modality, name: t.name, frequency: t.frequency, items: t.items, isExample: true })));
  await logActivity("facility", facilityId, "imaging_qc", `${add.length} example QC templates added`, me.name);
  revalidatePath("/assets/imaging-qc");
  return go(page(facilityId, "templates"), `${add.length} example templates added. Adapt each to your scanners and phantoms before use.`);
}

const TemplateSchema = z.object({
  id: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().positive().optional()),
  facilityId: reqId("Hospital"), modality: oneOf("Modality", MODALITIES), name: reqText("Name", 160), frequency: oneOf("Frequency", FREQUENCIES),
  items: reqText("Items", 8000), active: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function saveTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const p = TemplateSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  if (!d.modality || !d.frequency) return { error: "Choose the modality and how often." };
  const parsed = parseItems(d.items);
  if (parsed.problems.length) return { error: parsed.problems.slice(0, 3).join(" "), fields: { items: parsed.problems[0] } };
  if (d.id) {
    const [t] = await db.select().from(imagingQcTemplates).where(eq(imagingQcTemplates.id, d.id));
    if (!t || t.facilityId !== d.facilityId) return { error: "That template no longer exists." };
    await db.update(imagingQcTemplates).set({ modality: d.modality, name: d.name, frequency: d.frequency, items: parsed.items, active: d.active, isExample: false }).where(eq(imagingQcTemplates.id, t.id));
    await logActivity("facility", d.facilityId, "imaging_qc", `QC template "${d.name}" updated`, me.name);
  } else {
    await db.insert(imagingQcTemplates).values({ facilityId: d.facilityId, modality: d.modality, name: d.name, frequency: d.frequency, items: parsed.items });
    await logActivity("facility", d.facilityId, "imaging_qc", `QC template "${d.name}" added`, me.name);
  }
  revalidatePath("/assets/imaging-qc");
  return go(page(d.facilityId, "templates"), "Template saved.");
}

/* ── Runs ── */

const RunSchema = z.object({ assetId: reqId("Scanner"), templateId: reqId("Template"), performedOn: isoDate("Date"), notes: text(2000) });

export async function recordQcRunAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.report");
  const p = RunSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, departmentId: assets.departmentId, code: deviceTypes.code, status: assets.status })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, d.assetId));
  if (!a || a.status === "DISPOSED") return { error: "That scanner is not in the register." };
  await requireFacilityAccess(a.facilityId, me);
  const [t] = await db.select().from(imagingQcTemplates).where(eq(imagingQcTemplates.id, d.templateId));
  if (!t || !t.active || t.facilityId !== a.facilityId) return { error: "That template is not in use in this hospital." };
  if (modalityOf(a.code) !== t.modality) return { error: "That template is for another modality." };
  const on = d.performedOn ?? todayISO();
  if (on > todayISO()) return { error: "The date can't be in the future.", fields: { performedOn: "In the future." } };
  const raw = t.items.map((_, i) => ({ result: fd.get(`r_${i}`)?.toString() ?? null, value: fd.get(`v_${i}`)?.toString() ?? null, note: fd.get(`n_${i}`)?.toString() ?? null }));
  const j = judgeRun(t.items, raw);
  if (j.problems.length) return { error: j.problems.slice(0, 4).join(" ") };
  const [r] = await db.insert(imagingQcRecords).values({
    templateId: t.id, assetId: a.id, facilityId: a.facilityId, departmentId: a.departmentId, performedOn: on, items: t.items, answers: j.answers,
    passed: j.passed, failedCount: j.failed.length, notes: d.notes ?? null, performedById: me.id, performedByName: me.name,
  }).returning({ id: imagingQcRecords.id });
  await logActivity("asset", a.id, "imaging_qc", `${t.name}: ${j.passed ? "passed" : `FAILED (${j.failed.slice(0, 2).join("; ")})`}`.slice(0, 300), me.name);
  revalidatePath("/assets/imaging-qc"); revalidatePath(`/assets/${a.id}`);
  if (!j.passed) return go(page(a.facilityId, "records", `&recordId=${r.id}`), `QC failed: ${j.failed.join("; ")}. Open a work order from the record if the scanner needs a repair.`.slice(0, 600), "error");
  return go(page(a.facilityId, "due"), `${a.tag}: QC passed and saved.`);
}

/** One click from a failed run: a corrective work order for the scanner, linked to the run. */
export async function openQcWorkOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.report");
  const rid = Number(fd.get("recordId"));
  const [r] = Number.isInteger(rid) && rid > 0 ? await db.select({ q: imagingQcRecords, name: imagingQcTemplates.name, tag: assets.assetTag, criticality: assets.criticality })
    .from(imagingQcRecords).innerJoin(imagingQcTemplates, eq(imagingQcTemplates.id, imagingQcRecords.templateId)).innerJoin(assets, eq(assets.id, imagingQcRecords.assetId))
    .where(eq(imagingQcRecords.id, rid)) : [];
  if (!r) return { error: "That QC record no longer exists." };
  await requireFacilityAccess(r.q.facilityId, me);
  if (r.q.passed) return { error: "This run passed: no work order is needed." };
  if (r.q.workOrderId) return { error: "A work order is already open for this run." };
  if (await quarantineFor(r.q.assetId)) return { error: "This scanner is kept as found (quarantined): no repair work until it is released." };
  const failed = r.q.answers.filter((a) => a.result === "FAIL").map((a) => `${a.label}${a.value != null ? `: ${a.value}` : ""}`);
  const now = new Date();
  const cover = await coverForAsset(r.q.assetId, todayISO(now));
  const priority = "HIGH" as const;
  const wo = await db.transaction(async (tx) => {
    const number = await nextNumber("WO", workOrders, workOrders.number, tx);
    const [w] = await tx.insert(workOrders).values({
      number, assetId: r.q.assetId, facilityId: r.q.facilityId, type: "CORRECTIVE", priority, status: "OPEN", title: failureTitle(r.name, failed),
      description: `Routine QC on ${r.q.performedOn} by ${r.q.performedByName ?? "the technologist"} failed:\n${failed.join("\n")}${r.q.notes ? `\n\n${r.q.notes}` : ""}`.slice(0, 4000),
      deviceDown: false, reportedById: me.id, reportedByName: me.name, reportedAt: now, dueAt: responseDue(now, priority),
      coverage: cover.kind, contractId: cover.kind === "CONTRACT" ? cover.contract.id : null,
    }).returning({ id: workOrders.id, number: workOrders.number, assetId: workOrders.assetId, deviceDown: workOrders.deviceDown });
    const linked = await tx.update(imagingQcRecords).set({ workOrderId: w.id }).where(and(eq(imagingQcRecords.id, r.q.id), eq(imagingQcRecords.passed, false))).returning({ id: imagingQcRecords.id });
    if (!linked.length) throw new Error("race");
    await logActivity("work_order", w.id, "reported", `Raised from a failed QC run (${r.name}, ${r.q.performedOn})`, me.name, tx);
    await logActivity("asset", r.q.assetId, "work_order", `${w.number} raised from failed QC`, me.name, tx);
    await applyAssetEffect("report", w, { actor: me.name }, tx);
    return w;
  });
  await notifyAssigners(r.q.facilityId, me.id, { kind: "work_order_reported", title: `${wo.number}: QC failed on ${r.tag}`, body: failed.slice(0, 3).join("; "), href: `/assets/work-orders/${wo.id}`, dedupeKey: `wo_reported:${wo.id}` });
  revalidatePath("/assets/imaging-qc");
  return go(`/assets/work-orders/${wo.id}`, `${wo.number} raised for ${r.tag}. The biomedical team has been told.`);
}

/* ── Monthly review ── */

const ReviewSchema = z.object({ facilityId: reqId("Hospital"), departmentId: reqId("Department"), month: reqText("Month", 7), reviewerRole: oneOf("Reviewer", REVIEWER_ROLES), comments: text(4000) });

export async function signQcReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("workorders.report");
  const p = ReviewSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  const mayAll = can(me.role, "incidents.manage");
  if (!mayAll && !(me.role === "DEPARTMENT_HEAD" && (await myDepartments(me.id)).has(d.departmentId))) {
    return { error: "The review is signed by the responsible radiologist or physicist: biomedical engineering or the department's head." };
  }
  const today = todayISO();
  if (!reviewMonths(today).includes(d.month)) return { error: "Choose this month or one of the two before." };
  const dept = (await qcMonth(d.facilityId, d.month, today)).find((x) => x.id === d.departmentId);
  if (!dept) return { error: "That department has no scanners with QC templates." };
  if (dept.review) return { error: `Already signed by ${dept.review.signedByName}.` };
  if ((dept.failed > 0 || dept.missed > 0) && !d.comments) return { error: "Some runs failed or were missed: say what was done about them.", fields: { comments: "Comment on the failed or missed runs." } };
  try {
    await db.insert(imagingQcReviews).values({
      facilityId: d.facilityId, departmentId: d.departmentId, month: d.month, reviewerRole: d.reviewerRole ?? "RADIOLOGIST", comments: d.comments ?? null,
      runs: dept.runs, failed: dept.failed, missed: dept.missed, signedById: me.id, signedByName: me.name,
    });
  } catch { return { error: "This month was signed a moment ago. Reload the page." }; }
  await logActivity("facility", d.facilityId, "imaging_qc", `QC review ${d.month} for ${dept.name} signed by ${me.name}`, me.name);
  revalidatePath("/assets/imaging-qc");
  return go(page(d.facilityId, "review", `&month=${d.month}`), `Review for ${dept.name}, ${d.month}, signed.`);
}


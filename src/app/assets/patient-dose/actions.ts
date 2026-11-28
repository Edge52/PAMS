"use server";
/**
 * Patient dose and DRLs (wave 43, GAHAR DAS.09). Reference levels are kept by biomedical (`catalogue.edit`, as QC
 * templates); dose records are entered or imported by imaging staff (`maintenance.edit`); the medical physicist's
 * review of a month above the DRL needs `incidents.manage`. Every record is checked against the hospital the user
 * may see. No patient names or identifiers are taken. Rules: src/lib/assets/patient-dose.ts.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { doseRecords, doseReferenceLevels, doseReviews } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { dbError, firstError, formObject, int, isoDate, num, oneOf, reqId, reqText, text, type FormState } from "@/lib/assets/forms";
import {
  AGE_GROUPS, DOSE_MODALITIES, DOSE_QUANTITIES, doseRecordProblem, EXAMPLE_DRLS, EXAMPLE_SOURCE, examKey, MODALITY_QUANTITIES, parseDoseTable, QUANTITY_LABELS,
} from "@/lib/assets/patient-dose";
import { doseLookups, doseScanners } from "@/lib/assets/patient-dose-server";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const page = (facilityId: number, tab: string, extra = "") => `/assets/patient-dose?facilityId=${facilityId}&tab=${tab}${extra}`;
const go = (to: string, msg: string): never => redirect(`${to}${to.includes("?") ? "&" : "?"}notice=${encodeURIComponent(msg)}`);

/* ── Reference levels ── */

export async function addExampleDrlsAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const facilityId = Number(fd.get("facilityId"));
  if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose a hospital." };
  await requireFacilityAccess(facilityId, me);
  const have = new Set((await db.select({ m: doseReferenceLevels.modality, e: doseReferenceLevels.examType, a: doseReferenceLevels.ageGroup, q: doseReferenceLevels.quantity })
    .from(doseReferenceLevels).where(eq(doseReferenceLevels.facilityId, facilityId))).map((d) => `${d.m}|${examKey(d.e)}|${d.a}|${d.q}`));
  const add = EXAMPLE_DRLS.filter((d) => !have.has(`${d.modality}|${examKey(d.examType)}|ADULT|${d.quantity}`));
  if (!add.length) return { error: "The example levels are already there." };
  await db.insert(doseReferenceLevels).values(add.map((d) => ({ facilityId, modality: d.modality, examType: d.examType, ageGroup: "ADULT", quantity: d.quantity, value: d.value, source: EXAMPLE_SOURCE, isExample: true })));
  await logActivity("facility", facilityId, "patient_dose", `${add.length} example reference levels added`, me.name);
  revalidatePath("/assets/patient-dose");
  return go(page(facilityId, "levels"), `${add.length} example levels added. Replace each with your national or local DRL before use.`);
}

const DrlSchema = z.object({
  id: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().positive().optional()),
  facilityId: reqId("Hospital"), modality: oneOf("Modality", DOSE_MODALITIES), examType: reqText("Exam type", 160), ageGroup: oneOf("Age group", AGE_GROUPS),
  quantity: oneOf("Dose quantity", DOSE_QUANTITIES), value: num("DRL value", 0.000001, 1e7), source: reqText("Source", 300), sourceYear: int("Year", 1990, 2100),
  active: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function saveDrlAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const p = DrlSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  await requireFacilityAccess(d.facilityId, me);
  if (!d.modality || !d.quantity || d.value == null) return { error: "Choose the modality and the dose quantity, and enter the value.", fields: d.value == null ? { value: "Enter the DRL." } : undefined };
  if (!MODALITY_QUANTITIES[d.modality].includes(d.quantity)) return { error: `${QUANTITY_LABELS[d.quantity]} is not recorded for this modality.`, fields: { quantity: "Not for this modality." } };
  if (d.source.trim() === EXAMPLE_SOURCE) return { error: "Enter where this DRL comes from (national survey, local survey…).", fields: { source: "Enter the real source." } };
  const values = { modality: d.modality, examType: d.examType, ageGroup: d.ageGroup ?? "ADULT", quantity: d.quantity, value: d.value, source: d.source, sourceYear: d.sourceYear ?? null, active: d.active, isExample: false };
  try {
    if (d.id) {
      const [old] = await db.select().from(doseReferenceLevels).where(eq(doseReferenceLevels.id, d.id));
      if (!old || old.facilityId !== d.facilityId) return { error: "That reference level no longer exists." };
      await db.update(doseReferenceLevels).set(values).where(eq(doseReferenceLevels.id, old.id));
      await logActivity("facility", d.facilityId, "patient_dose", `DRL ${d.examType} ${QUANTITY_LABELS[d.quantity]} changed from ${old.value} to ${d.value} (${d.source})`, me.name);
    } else {
      await db.insert(doseReferenceLevels).values({ facilityId: d.facilityId, ...values });
      await logActivity("facility", d.facilityId, "patient_dose", `DRL ${d.examType} ${QUANTITY_LABELS[d.quantity]} ${d.value} added (${d.source})`, me.name);
    }
  } catch (e) {
    const msg = dbError(e, "The reference level could not be saved.");
    return { error: msg.startsWith("That code") ? "There is already a level for this exam type, age group and quantity: edit that one." : msg };
  }
  revalidatePath("/assets/patient-dose");
  return go(page(d.facilityId, "levels"), "Reference level saved.");
}

/* ── Dose records ── */

const RecordSchema = z.object({
  assetId: reqId("Scanner"), examDate: isoDate("Exam date"), examType: reqText("Exam type", 160), protocol: text(160), ageGroup: oneOf("Age group", AGE_GROUPS),
  ctdivol: num("CTDIvol", 0, 1e5), dlp: num("DLP", 0, 1e6), dap: num("DAP", 0, 1e5), esd: num("Entrance surface dose", 0, 1e5), time: num("Screening time", 0, 1e4), agd: num("Mean glandular dose", 0, 1e3),
});

export async function recordDoseAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = RecordSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.examDate) return { error: "Enter the exam date.", fields: { examDate: "Enter the date." } };
  const [sc] = (await doseScanners(await facilityScope(me))).filter((s) => s.id === d.assetId);
  if (!sc) return { error: "Choose an X-ray device you can see." };
  await requireFacilityAccess(sc.facilityId, me);
  const keep = Object.fromEntries(MODALITY_QUANTITIES[sc.modality].map((q) => [q, d[q] ?? null]));
  const problem = doseRecordProblem({ examDate: d.examDate, modality: sc.modality, ...keep }, todayISO());
  if (problem) return { error: problem };
  await db.insert(doseRecords).values({
    facilityId: sc.facilityId, assetId: sc.id, examDate: d.examDate, modality: sc.modality, examType: d.examType, protocol: d.protocol ?? null, ageGroup: d.ageGroup ?? "ADULT",
    ctdivol: keep.ctdivol ?? null, dlp: keep.dlp ?? null, dap: keep.dap ?? null, esd: keep.esd ?? null, fluoroTime: keep.time ?? null, agd: keep.agd ?? null,
    source: "ENTERED", enteredById: me.id, enteredByName: me.name,
  });
  revalidatePath("/assets/patient-dose");
  return go(page(sc.facilityId, "records"), `Dose record for ${sc.tag} saved.`);
}

export async function importDoseAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file exported from the RIS or dose system." };
  if (file.size > 10 * 1024 * 1024) return { error: "The file must be 10 MB or smaller." };
  if (!/\.(csv|txt)$/i.test(file.name)) return { error: "Save the export as CSV and upload that file." };
  const scope = await facilityScope(me);
  const r = parseDoseTable(await file.text(), await doseLookups(scope), todayISO());
  if (r.error) return { error: r.error };
  const bad = r.rows.filter((x) => x.errors.length);
  if (bad.length) return { error: `${bad.length} of ${r.rows.length} rows can't be read, so nothing was saved. ${bad.slice(0, 5).map((x) => `Row ${x.rowNumber}: ${x.errors.join(" ")}`).join(" ")}` };
  if (!r.valid.length) return { error: "No exams found in the file." };
  const facs = [...new Set(r.valid.map((v) => v.facilityId))];
  for (const f of facs) await requireFacilityAccess(f, me);
  const name = file.name.slice(0, 200);
  await db.transaction(async (tx) => {
    for (let i = 0; i < r.valid.length; i += 1000) {
      await tx.insert(doseRecords).values(r.valid.slice(i, i + 1000).map((v) => ({
        facilityId: v.facilityId, assetId: v.assetId, examDate: v.examDate, modality: v.modality, examType: v.examType, protocol: v.protocol, ageGroup: v.ageGroup,
        ctdivol: v.ctdivol ?? null, dlp: v.dlp ?? null, dap: v.dap ?? null, esd: v.esd ?? null, fluoroTime: v.time ?? null, agd: v.agd ?? null,
        source: "IMPORT", importFile: name, enteredById: me.id, enteredByName: me.name,
      })));
    }
    for (const f of facs) await logActivity("facility", f, "patient_dose", `${r.valid.filter((v) => v.facilityId === f).length} dose records imported from ${name}`, me.name, tx);
  });
  revalidatePath("/assets/patient-dose");
  return go(page(facs[0], "check"), `${r.valid.length} exams imported from ${name}.`);
}

/* ── Physicist review ── */

const ReviewSchema = z.object({
  assetId: reqId("Scanner"), modality: oneOf("Modality", DOSE_MODALITIES), examType: reqText("Exam type", 160), ageGroup: oneOf("Age group", AGE_GROUPS),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Choose the month."), figures: text(500),
  findings: reqText("What was found", 4000), action: reqText("Action taken", 4000), reviewedOn: isoDate("Review date"),
});

export async function saveDoseReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("incidents.manage");
  const p = ReviewSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.modality || !d.ageGroup) return { error: "The review is missing its exam group. Open it again from the monthly check." };
  const [sc] = (await doseScanners(await facilityScope(me))).filter((s) => s.id === d.assetId);
  if (!sc) return { error: "Choose an X-ray device you can see." };
  await requireFacilityAccess(sc.facilityId, me);
  const today = todayISO(), on = d.reviewedOn ?? today;
  if (on > today) return { error: "The review date can't be in the future.", fields: { reviewedOn: "In the future." } };
  const key = examKey(d.examType);
  const values = { findings: d.findings, action: d.action, figures: d.figures ?? null, reviewedOn: on, reviewedById: me.id, reviewedByName: me.name };
  await db.insert(doseReviews).values({ facilityId: sc.facilityId, assetId: sc.id, modality: d.modality, examKey: key, examType: d.examType, ageGroup: d.ageGroup, month: d.month, ...values })
    .onConflictDoUpdate({ target: [doseReviews.assetId, doseReviews.modality, doseReviews.examKey, doseReviews.ageGroup, doseReviews.month], set: { ...values, updatedAt: sql`now()` } });
  await logActivity("asset", sc.id, "dose_review", `Patient dose review ${d.examType} ${d.month}: ${d.action.slice(0, 200)}`, me.name);
  revalidatePath("/assets/patient-dose");
  return go(page(sc.facilityId, "check", `&month=${d.month}`), `Review of ${d.examType} on ${sc.tag} saved.`);
}

/** Remove a wrongly entered dose record (biomedical). */
export async function deleteDoseRecordAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("catalogue.edit");
  const id = Number(fd.get("id"));
  const [r] = Number.isInteger(id) && id > 0 ? await db.select().from(doseRecords).where(eq(doseRecords.id, id)) : [];
  if (!r) return { error: "That record no longer exists." };
  await requireFacilityAccess(r.facilityId, me);
  await db.delete(doseRecords).where(and(eq(doseRecords.id, r.id), eq(doseRecords.facilityId, r.facilityId)));
  await logActivity("asset", r.assetId, "dose_record_removed", `Dose record of ${r.examDate} (${r.examType}) removed`, me.name);
  revalidatePath("/assets/patient-dose");
  return go(page(r.facilityId, "records"), "Dose record removed.");
}

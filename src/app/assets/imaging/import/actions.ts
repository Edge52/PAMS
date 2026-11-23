"use server";
/**
 * Daily exam counts from a RIS/PACS or modality export (wave 38). Import needs `assets.edit` (as monthly imaging use);
 * AE titles `assets.edit` and the device's hospital. Step 1 checks the file and saves nothing; step 2 re-checks the
 * rows against the live register and replaces those device-days. Rules in src/lib/assets/exam-import.ts.
 */
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assetAeTitles, assets, deviceTypes } from "@/db/schema";
import { facilityScope, requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { cleanAeTitle, EXAM_MAX_ROWS, mapExamHeaders, parseCsv, validateExamRows, type ExamRow, type ValidExam } from "@/lib/assets/exam-import";
import { examLookups, saveExamCounts } from "@/lib/assets/exam-counts-server";
import { fail, type ActionState } from "@/lib/procurement/forms";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

export type ExamPreview = { error?: string; done?: string; fileName?: string; rows?: ExamRow[]; validCount?: number; errorCount?: number; days?: number; payload?: string } | null;

async function readTable(file: File): Promise<unknown[][] | string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.endsWith("/csv")) return parseCsv(await file.text());
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer); }
  catch { return "That file is not a readable CSV or .xlsx workbook. Save it as CSV or Excel Workbook (.xlsx) and try again."; }
  const ws = wb.worksheets[0];
  if (!ws) return "The workbook has no sheets.";
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => { out.push((row.values as unknown[]).slice(1)); });
  return out;
}

export async function previewExamImportAction(_: ExamPreview, fd: FormData): Promise<ExamPreview> {
  const me = await requirePermission("assets.edit");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV or Excel file to upload." };
  if (file.size > 10 * 1024 * 1024) return { error: "The file must be 10 MB or smaller." };
  const table = await readTable(file);
  if (typeof table === "string") return { error: table };
  if (table.length < 2) return { error: "The file needs a header row and at least one row of counts." };
  const { map, missing } = mapExamHeaders(table[0]);
  if (missing.length) return { error: `The first row must name the columns. Missing: ${missing.join(", ")}. Accepted names include "AE title" or "Device tag", "Date" and "Exams".` };
  if (table.length - 1 > EXAM_MAX_ROWS) return { error: `That file has ${table.length - 1} rows; import at most ${EXAM_MAX_ROWS.toLocaleString("en")} at a time.` };
  const raw = table.slice(1).map((cells, i) => ({ rowNumber: i + 2, cells }));
  const { rows, valid } = validateExamRows(raw, map, await examLookups(await facilityScope(me)), todayISO());
  const days = new Set(valid.map((v) => `${v.assetId}|${v.day}`)).size;
  return { fileName: file.name, rows: [...rows.filter((r) => r.errors.length), ...rows.filter((r) => !r.errors.length)].slice(0, 1000), validCount: valid.length, errorCount: rows.filter((r) => r.errors.length).length, days, payload: JSON.stringify({ fileName: file.name, valid }) };
}

const ValidSchema = z.object({ assetId: z.number().int().positive(), tag: z.string(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), procedure: z.string().max(200), modality: z.string().max(16).nullable(), exams: z.number().int().min(0).max(10000) });

export async function commitExamImportAction(_: ExamPreview, fd: FormData): Promise<ExamPreview> {
  const me = await requirePermission("assets.edit");
  let parsed: { fileName: string; valid: ValidExam[] };
  try { parsed = z.object({ fileName: z.string().max(255), valid: z.array(ValidSchema).min(1).max(EXAM_MAX_ROWS) }).parse(JSON.parse(String(fd.get("payload") ?? ""))); }
  catch { return { error: "The preview expired. Upload the file again." }; }
  // The payload comes from the browser: every device must still be one the user can see.
  const lk = await examLookups(await facilityScope(me));
  const seen = new Map([...lk.byTag.values()].map((d) => [d.assetId, d]));
  if (parsed.valid.some((v) => !seen.has(v.assetId) || seen.get(v.assetId)!.tag !== v.tag)) return { error: "Some devices are no longer in the register you can see. Upload the file again." };
  if (parsed.valid.some((v) => v.day > todayISO())) return { error: "Some dates are in the future. Upload the file again." };
  const r = await saveExamCounts(parsed.valid, parsed.fileName, me.name);
  for (const id of new Set(parsed.valid.map((v) => v.assetId))) {
    const n = parsed.valid.filter((v) => v.assetId === id);
    await logActivity("asset", id, "exam_counts_imported", `${new Set(n.map((v) => v.day)).size} days of exam counts imported from ${parsed.fileName}`, me.name);
  }
  revalidatePath("/assets/imaging");
  revalidatePath("/assets/imaging/import");
  return { done: `${r.deviceDays} device-days saved for ${r.devices} device${r.devices === 1 ? "" : "s"}; ${r.months} month total${r.months === 1 ? "" : "s"} updated in imaging use.` };
}

export async function addAeTitleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const assetId = Number(fd.get("assetId"));
  const ae = cleanAeTitle(String(fd.get("aeTitle") ?? ""));
  if (!ae) return { errors: ["An AE title is 1 to 16 letters, digits or symbols, without a backslash."], fields: { aeTitle: "1–16 characters." } };
  const [a] = Number.isInteger(assetId) && assetId > 0 ? await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, code: deviceTypes.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId)) : [];
  if (!a || !a.code.startsWith("IMG-")) return fail("AE titles are for imaging devices.");
  await requireFacilityAccess(a.facilityId, me);
  const [taken] = await db.select({ assetId: assetAeTitles.assetId, tag: assets.assetTag }).from(assetAeTitles).innerJoin(assets, eq(assets.id, assetAeTitles.assetId)).where(eq(assetAeTitles.aeTitle, ae));
  if (taken) return taken.assetId === a.id ? { message: `${ae} is already this device's.` } : { errors: [`${ae} already belongs to ${taken.tag}.`], fields: { aeTitle: `Used by ${taken.tag}.` } };
  await db.insert(assetAeTitles).values({ aeTitle: ae, assetId: a.id });
  await logActivity("asset", a.id, "ae_title_added", `AE title ${ae} added`, me.name);
  revalidatePath(`/assets/${a.id}`);
  revalidatePath("/assets/imaging/import");
  return { message: `AE title ${ae} added.` };
}

export async function removeAeTitleAction(fd: FormData) {
  const me = await requirePermission("assets.edit");
  const ae = cleanAeTitle(String(fd.get("aeTitle") ?? ""));
  if (!ae) return;
  const [row] = await db.select({ assetId: assetAeTitles.assetId, facilityId: assets.facilityId }).from(assetAeTitles).innerJoin(assets, eq(assets.id, assetAeTitles.assetId)).where(eq(assetAeTitles.aeTitle, ae));
  if (!row) return;
  await requireFacilityAccess(row.facilityId, me);
  await db.delete(assetAeTitles).where(eq(assetAeTitles.aeTitle, ae));
  await logActivity("asset", row.assetId, "ae_title_removed", `AE title ${ae} removed`, me.name);
  revalidatePath(`/assets/${row.assetId}`);
  revalidatePath("/assets/imaging/import");
}

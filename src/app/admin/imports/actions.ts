"use server";
/**
 * Wave 41: CSV / Excel imports of suppliers, service contracts, users, PPM schedules and spare parts. Each kind needs
 * its own permission (KIND_INFO.perm) and, when kept per hospital, access to that hospital. Step 1 checks every row
 * and writes nothing; step 2 checks the rows again and writes the valid ones.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { IMPORT_KINDS, KIND_INFO, type ImportKind } from "@/lib/imports/kinds";
import { checkRows, writeRows } from "@/lib/imports/kinds-server";
import { MAX_ROWS, readUpload } from "@/lib/imports/read-server";
import type { ImportState } from "@/lib/imports/state";

const kindOf = (v: FormDataEntryValue | null): ImportKind | null => (IMPORT_KINDS as readonly string[]).includes(String(v)) ? (String(v) as ImportKind) : null;

export async function previewKindImportAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const kind = kindOf(fd.get("kind"));
  if (!kind) return { error: "Choose what to import." };
  const info = KIND_INFO[kind];
  const me = await requirePermission(info.perm);
  let facilityId: number | null = null;
  if (info.perHospital) {
    facilityId = Number(fd.get("facilityId"));
    if (!Number.isInteger(facilityId) || facilityId <= 0) return { error: "Choose the hospital to import into." };
    await requireFacilityAccess(facilityId, me);
  }
  const read = await readUpload(fd.get("file"), info.columns);
  if ("error" in read) return { error: read.error };
  const rows = await checkRows(kind, read.rows, facilityId, me);
  const valid = rows.filter((r) => !r.errors.length);
  return {
    fileName: read.fileName, unknownHeaders: read.unknown, validCount: valid.length, errorCount: rows.length - valid.length,
    rows: rows.map(({ rowNumber, values, errors, warnings }) => ({ rowNumber, values, errors, warnings })),
    payload: valid.length ? JSON.stringify({ kind, facilityId, rows: read.rows.filter((r) => valid.some((v) => v.rowNumber === r.rowNumber)) }) : "",
  };
}

const Payload = z.object({
  kind: z.enum(IMPORT_KINDS), facilityId: z.number().int().positive().nullable(),
  rows: z.array(z.object({ rowNumber: z.number().int(), cells: z.record(z.string(), z.unknown()) })).min(1).max(MAX_ROWS),
});

export async function commitKindImportAction(_: ImportState, fd: FormData): Promise<ImportState> {
  let p: z.infer<typeof Payload>;
  try { p = Payload.parse(JSON.parse(String(fd.get("payload") ?? ""))); } catch { return { error: "The check expired. Upload the file again." }; }
  const info = KIND_INFO[p.kind];
  const me = await requirePermission(info.perm);
  if (info.perHospital) {
    if (!p.facilityId) return { error: "Choose the hospital to import into." };
    await requireFacilityAccess(p.facilityId, me); // the payload comes from the browser: check it again
  }
  const rows = await checkRows(p.kind, p.rows, info.perHospital ? p.facilityId : null, me);
  const bad = rows.filter((r) => r.errors.length);
  if (bad.length) return { error: `Some rows are no longer valid (${bad.slice(0, 3).map((r) => `row ${r.rowNumber}: ${r.errors[0]}`).join("; ")}). Upload the file again to refresh the check.` };
  let n: number;
  try { n = await writeRows(p.kind, rows.map((r) => r.value), info.perHospital ? p.facilityId : null, me); }
  catch (e) { return { error: `Nothing was imported: ${e instanceof Error ? e.message : "the database refused the rows"}.` }; }
  revalidatePath(info.href);
  return { done: `${n} ${n === 1 ? info.what.replace(/s$/, "") : info.what} imported.`, doneHref: info.href, doneLabel: info.label };
}

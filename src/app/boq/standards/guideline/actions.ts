"use server";
/**
 * Wave 41: load the National Medical Equipment Guideline from the filled-in template as a standard set marked
 * "National guideline (imported)". Needs `standards.edit`. Importing the same version again replaces its rules.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { boqRules, standardSets } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { GUIDELINE_COLUMNS, GUIDELINE_MARK, guidelineCode, ruleNote, validateGuideline } from "@/lib/boq/guideline";
import { guidelineLookups } from "@/lib/boq/guideline-server";
import { readUpload } from "@/lib/imports/read-server";
import type { ImportState } from "@/lib/imports/state";
import { logActivity } from "@/lib/server-utils";

async function check(rows: { rowNumber: number; cells: Record<string, unknown> }[]) {
  return validateGuideline(rows, await guidelineLookups());
}

export async function previewGuidelineAction(_: ImportState, fd: FormData): Promise<ImportState> {
  await requirePermission("standards.edit");
  const read = await readUpload(fd.get("file"), GUIDELINE_COLUMNS);
  if ("error" in read) return { error: read.error };
  const { rows, rules } = await check(read.rows);
  const valid = rows.filter((r) => !r.errors.length).length;
  return {
    fileName: read.fileName, rows: rows.map(({ rowNumber, values, errors }) => ({ rowNumber, values, errors })), validCount: valid, errorCount: rows.length - valid,
    unknownHeaders: read.unknown, payload: rules.length ? JSON.stringify(read.rows.filter((r) => !rows.find((x) => x.rowNumber === r.rowNumber)?.errors.length)) : "",
  };
}

const Payload = z.array(z.object({ rowNumber: z.number().int(), cells: z.record(z.string(), z.unknown()) })).min(1).max(2000);

export async function commitGuidelineAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const me = await requirePermission("standards.edit");
  let raw: z.infer<typeof Payload>;
  try { raw = Payload.parse(JSON.parse(String(fd.get("payload") ?? ""))); } catch { return { error: "The check expired. Upload the file again." }; }
  // The rows come back from the browser: check them again against the catalogue as it is now.
  const { rows, rules, version } = await check(raw);
  if (rows.some((r) => r.errors.length) || !rules.length) return { error: "Some rows are no longer valid. Upload the file again to refresh the check." };
  const code = guidelineCode(version);
  const source = rules.find((r) => r.source)?.source ?? "GAHAR National Medical Equipment Guideline";
  const set = await db.transaction(async (tx) => {
    const values = {
      name: `National Medical Equipment Guideline${version ? ` ${version}` : ""} (imported)`,
      description: `${GUIDELINE_MARK}. Typed or pasted from the guideline's app into the PAMS template and imported by ${me.name}; check it against the published guideline.`,
      version: (version ?? "1.0").slice(0, 16), sources: [{ id: "natguide", title: source, publisher: "GAHAR", year: version && /^\d{4}/.test(version) ? Number(version.slice(0, 4)) : undefined }],
    };
    const [was] = await tx.select({ id: standardSets.id }).from(standardSets).where(eq(standardSets.code, code));
    const id = was ? (await tx.update(standardSets).set(values).where(eq(standardSets.id, was.id)).returning({ id: standardSets.id }))[0].id
      : (await tx.insert(standardSets).values({ code, ...values }).returning({ id: standardSets.id }))[0].id;
    if (was) await tx.delete(boqRules).where(eq(boqRules.standardSetId, id));
    for (let i = 0; i < rules.length; i += 500) {
      await tx.insert(boqRules).values(rules.slice(i, i + 500).map((r) => ({
        standardSetId: id, departmentTypeCode: r.departmentTypeCode, deviceTypeId: r.deviceTypeId, basis: r.basis, ratio: r.ratio,
        rounding: "CEIL" as const, tier: "ESSENTIAL" as const, confidence: "SOURCED" as const, sourceRef: "natguide", notes: ruleNote(r),
      })));
    }
    await logActivity("standard_set", id, was ? "updated" : "created", `${GUIDELINE_MARK}: ${rules.length} rules${was ? " (replaced)" : ""}`, me.name, tx);
    return { id, replaced: !!was };
  });
  revalidatePath("/boq/standards");
  return { done: `${rules.length} guideline rules ${set.replaced ? "replaced" : "loaded"} as ${code}.`, doneHref: `/boq/standards/${set.id}`, doneLabel: "Open the standard set" };
}

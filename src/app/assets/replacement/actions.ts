"use server";
/**
 * Replacement plan → BOQ. The new BOQ uses an empty standard set ("Replacement plan"), so regenerating it never adds
 * rule lines: it holds exactly the devices chosen here, one line per department and device type, each line saying
 * which assets it replaces and why.
 */
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, boqDepartments, boqLines, boqs, departments, standardSets } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { defaultUnitPrices } from "@/lib/boq/generate";
import { replacementPlan } from "@/lib/assets/lifecycle-server";
import type { FormState } from "@/lib/assets/forms";
import { convert, logActivity } from "@/lib/server-utils";

const REPLACEMENT_SET = "HPAMS-REPLACEMENT";

async function replacementSetId(): Promise<number> {
  await db.insert(standardSets).values({
    code: REPLACEMENT_SET, name: "Replacement plan (no ratio rules)", version: "1.0", isDefault: false,
    description: "Used by BOQs created from the replacement plan. It has no rules, so regenerating such a BOQ keeps only its replacement lines.",
  }).onConflictDoNothing();
  const [s] = await db.select({ id: standardSets.id }).from(standardSets).where(eq(standardSets.code, REPLACEMENT_SET));
  return s.id;
}

export async function createReplacementBoqAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("boq.edit");
  const ids = [...new Set(fd.getAll("assetIds").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const name = String(fd.get("name") ?? "").trim().slice(0, 200);
  if (!ids.length) return { error: "Tick the devices to replace." };
  if (ids.length > 2000) return { error: "Choose at most 2,000 devices for one BOQ." };
  if (name.length < 2) return { error: "Give the BOQ a name." };
  const facs = await db.selectDistinct({ f: assets.facilityId }).from(assets).where(inArray(assets.id, ids));
  if (facs.length !== 1) return { error: "Choose devices from one hospital at a time (filter by hospital first)." };
  const facilityId = facs[0].f;
  await requireFacilityAccess(facilityId, me);

  const plan = await replacementPlan(inArray(assets.id, ids));
  if (!plan.length) return { error: "None of those devices is in use any more." };
  const depts = new Map((await db.select({ id: departments.id, name: departments.name, code: departments.departmentTypeCode }).from(departments)
    .where(eq(departments.facilityId, facilityId))).map((d) => [d.id, d]));
  const prices = await defaultUnitPrices(db, plan.map((p) => p.typeId), "EGP", convert);
  const setId = await replacementSetId();

  const boqId = await db.transaction(async (tx) => {
    const [boq] = await tx.insert(boqs).values({
      name, facilityId, standardSetId: setId, currency: "EGP", contingencyPct: 0,
      notes: `Created from the replacement plan on ${new Date().toISOString().slice(0, 10)} for ${plan.length} device${plan.length === 1 ? "" : "s"}.`,
    }).returning({ id: boqs.id });
    // One BOQ department per real department (devices without one go to hospital-wide).
    const byDept = new Map<number | null, typeof plan>();
    for (const p of plan) byDept.set(p.departmentId, [...(byDept.get(p.departmentId) ?? []), p]);
    for (const [deptId, rows] of byDept) {
      const dep = deptId != null ? depts.get(deptId) : undefined;
      const [bd] = await tx.insert(boqDepartments).values({
        boqId: boq.id, departmentTypeCode: dep?.code ?? "HOSP", departmentId: dep ? deptId : null, label: dep?.name ?? "Hospital-wide (no department)",
      }).returning({ id: boqDepartments.id });
      const byType = new Map<number, typeof plan>();
      for (const r of rows) byType.set(r.typeId, [...(byType.get(r.typeId) ?? []), r]);
      for (const [typeId, list] of byType) {
        const price = prices.get(typeId);
        const replace = list.some((x) => x.score.band === "REPLACE");
        const listed = list.slice(0, 12).map((x) => `${x.tag} (score ${x.score.score})`).join(", ") + (list.length > 12 ? ` and ${list.length - 12} more` : "");
        await tx.insert(boqLines).values({
          boqId: boq.id, boqDepartmentId: bd.id, deviceTypeId: typeId, tier: replace ? "ESSENTIAL" : "RECOMMENDED",
          calculatedQty: list.length, quantity: list.length, isManual: true, unitPriceEstimate: price?.price ?? null,
          calcExplanation: `Replaces ${listed}`.slice(0, 1000),
          notes: [...new Set(list.flatMap((x) => x.score.reasons))].slice(0, 4).join("; ") || null,
        });
      }
    }
    await logActivity("boq", boq.id, "created", `Replacement BOQ created for ${plan.length} devices in ${byDept.size} department${byDept.size === 1 ? "" : "s"}`, me.name, tx);
    return boq.id;
  });
  revalidatePath("/boq");
  redirect(`/boq/${boqId}?notice=${encodeURIComponent("Replacement BOQ created. Review prices and quantities, then submit it for approval.")}`);
}

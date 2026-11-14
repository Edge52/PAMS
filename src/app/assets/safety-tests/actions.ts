"use server";
/**
 * Electrical safety test actions (wave 23). Recording a test needs `maintenance.edit` (biomedical engineers and
 * technicians); marking a device as test equipment and setting its calibration date needs `assets.edit`.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, safetyTests } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, isoDate, num, oneOf, reqId, text } from "@/lib/assets/forms";
import { analyserProblem, APPLIED_PARTS, judge, METHODS, nextTestDue, PROTECTION_CLASSES } from "@/lib/assets/safety-tests";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const flag = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const reqDate = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`));

const TestSchema = z.object({
  assetId: reqId("Device"), testedOn: reqDate("test date"),
  protectionClass: z.enum(PROTECTION_CLASSES, { error: "Choose the protection class." }),
  appliedPart: oneOf("Applied part", APPLIED_PARTS), method: oneOf("Method", METHODS),
  visualOk: flag, functionalOk: flag,
  earthResistanceOhm: num("Protective earth resistance", 0, 100), insulationMOhm: num("Insulation resistance", 0, 100000),
  equipmentLeakageUa: num("Equipment leakage", 0, 100000), appliedPartLeakageUa: num("Applied part leakage", 0, 100000),
  analyserAssetId: reqId("Test device"), workOrderId: id(), notes: text(2000),
});

export async function recordSafetyTestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = TestSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, interval: deviceTypes.ppmIntervalMonths })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  const today = new Date().toISOString().slice(0, 10);
  if (d.testedOn > today) return { errors: ["The test date can't be in the future."], fields: { testedOn: "This date is in the future." } };
  // The analyser must be test equipment of the same hospital, with its calibration in date on the day of the test.
  const [an] = await db.select({ id: assets.id, tag: assets.assetTag, manufacturer: assets.manufacturer, model: assets.model, serial: assets.serialNumber, calibrationDue: assets.calibrationDue })
    .from(assets).where(and(eq(assets.id, d.analyserAssetId), eq(assets.isTestEquipment, true), eq(assets.facilityId, a.facilityId)));
  if (!an) return { errors: ["Choose the analyser used for the test."], fields: { analyserAssetId: "Choose an analyser from this hospital's test equipment." } };
  const label = [an.manufacturer, an.model].filter(Boolean).join(" ") || an.tag;
  const blocked = analyserProblem({ label: `${label} (${an.tag})`, calibrationDue: an.calibrationDue }, d.testedOn);
  if (blocked) return { errors: [blocked], fields: { analyserAssetId: "This analyser's calibration is not in date." } };

  const reading = {
    protectionClass: d.protectionClass, appliedPart: d.appliedPart ?? "NONE", method: d.method ?? "DIRECT", visualOk: d.visualOk, functionalOk: d.functionalOk,
    earthResistanceOhm: d.earthResistanceOhm ?? null, insulationMOhm: d.insulationMOhm ?? null, equipmentLeakageUa: d.equipmentLeakageUa ?? null, appliedPartLeakageUa: d.appliedPartLeakageUa ?? null,
  };
  const verdict = judge(reading);
  const nextDue = verdict.result === "PASS" ? nextTestDue(d.testedOn, a.interval) : null;
  const [row] = await db.insert(safetyTests).values({
    assetId: a.id, workOrderId: d.workOrderId ?? null, testedOn: d.testedOn, testedById: me.id, testedByName: me.name, ...reading,
    analyserAssetId: an.id, analyserLabel: `${label}${an.serial ? `, serial ${an.serial}` : ""} (${an.tag})`, analyserCalibrationDue: an.calibrationDue,
    result: verdict.result, failures: verdict.failures, nextDue, notes: d.notes ?? null,
  }).returning({ id: safetyTests.id });
  await logActivity("asset", a.id, "safety_test", `Electrical safety test ${verdict.result === "PASS" ? "passed" : "FAILED"}${verdict.failures.length ? `: ${verdict.failures[0]}` : ""}`.slice(0, 300), me.name);
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/safety-tests");
  const msg = verdict.result === "PASS" ? `Passed. Next test due ${nextDue}.` : `Failed: ${verdict.failures.join(" ")} Take the device out of use and raise a work order.`;
  return redirect(`/assets/${a.id}?${verdict.result === "PASS" ? "notice" : "error"}=${encodeURIComponent(msg)}#safety-tests-${row.id}`);
}

const EquipmentSchema = z.object({ assetId: reqId("Device"), isTestEquipment: flag, calibrationDue: isoDate("Calibration due"), calibrationCertRef: text(120) });

export async function setTestEquipmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = EquipmentSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  if (d.isTestEquipment && !d.calibrationDue) return { errors: ["Enter when the calibration runs out."], fields: { calibrationDue: "Test equipment needs a calibration date." } };
  await db.update(assets).set({ isTestEquipment: d.isTestEquipment, calibrationDue: d.isTestEquipment ? d.calibrationDue ?? null : null, calibrationCertRef: d.isTestEquipment ? d.calibrationCertRef ?? null : null }).where(eq(assets.id, a.id));
  await logActivity("asset", a.id, "updated", d.isTestEquipment ? `Test equipment: calibration due ${d.calibrationDue}` : "No longer marked as test equipment", me.name);
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/safety-tests");
  return redirect(`/assets/${a.id}?notice=${encodeURIComponent("Saved.")}`);
}

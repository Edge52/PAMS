"use server";
/**
 * Utility systems (wave 41, GAHAR EFS.11). Marking an asset as a utility system and its figures need `assets.edit`;
 * recording a test needs `maintenance.edit`, with access to the hospital. A failed test opens a work order on the
 * system's asset. Rules: src/lib/utilities/utilities.ts.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, utilitySystems, utilityTests } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { firstError, formObject, isoDate, num, oneOf, reqId, text, type FormState } from "@/lib/assets/forms";
import { todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";
import { defaultsFor, failureTitle, judgeTest, KIND_LABELS, PRESSURES, TEST_FIELDS, TEST_KINDS, TEST_LABELS, UTILITY_KINDS, type Readings } from "@/lib/utilities/utilities";
import { raiseFailureJob } from "@/lib/utilities/utilities-server";

const go = (to: string, msg: string, kind: "notice" | "error" = "notice"): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
const on = (v: unknown) => v === "on" || v === "true";

const SystemSchema = z.object({
  id: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().positive().optional()),
  assetId: reqId("Device"), kind: oneOf("Kind", UTILITY_KINDS), serves: text(300), notes: text(2000),
  ratedKw: num("Rating (kW)", 0.1, 100000), requiredMinutes: num("Autonomy needed", 0, 10000), minFuelPct: num("Lowest fuel level", 0, 100),
  tempLow: num("Lowest temperature", -90, 60), tempHigh: num("Highest temperature", -90, 60), requiredAch: num("Air changes needed", 0, 200),
  pressure: oneOf("Pressure", PRESSURES), minPressurePa: num("Pressure difference", 0, 500),
});

export async function saveUtilitySystemAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.edit");
  const p = SystemSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.kind) return { error: "Choose what kind of system it is.", fields: { kind: "Choose a kind." } };
  if (d.tempLow != null && d.tempHigh != null && d.tempHigh <= d.tempLow) return { error: "The highest temperature must be above the lowest.", fields: { tempHigh: "Above the lowest." } };
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId, tag: assets.assetTag, typeCode: deviceTypes.code }).from(assets)
    .innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, d.assetId));
  if (!a) return { error: "That device is not in the register." };
  await requireFacilityAccess(a.facilityId, me);
  const def = defaultsFor(d.kind, a.typeCode);
  const values = {
    assetId: a.id, facilityId: a.facilityId, kind: d.kind, serves: d.serves ?? null, notes: d.notes ?? null, critical: on(fd.get("critical")),
    ratedKw: d.ratedKw ?? null, requiredMinutes: d.requiredMinutes ?? def.requiredMinutes ?? null, minFuelPct: d.minFuelPct ?? def.minFuelPct ?? null,
    tempLow: d.tempLow ?? def.tempLow ?? null, tempHigh: d.tempHigh ?? def.tempHigh ?? null, requiredAch: d.requiredAch ?? def.requiredAch ?? null,
    pressure: d.pressure ?? def.pressure ?? null, minPressurePa: d.minPressurePa ?? def.minPressurePa ?? null,
    active: d.id ? on(fd.get("active")) : true,
  };
  if (d.id) {
    const [s] = await db.select().from(utilitySystems).where(eq(utilitySystems.id, d.id));
    if (!s || s.assetId !== a.id) return { error: "That system no longer exists." };
    await db.update(utilitySystems).set(values).where(eq(utilitySystems.id, s.id));
    await logActivity("asset", a.id, "utility_system", `Utility system updated (${KIND_LABELS[d.kind]})`, me.name);
  } else {
    const [dup] = await db.select({ id: utilitySystems.id }).from(utilitySystems).where(eq(utilitySystems.assetId, a.id));
    if (dup) return { error: `${a.tag} is already a utility system.` };
    await db.insert(utilitySystems).values(values);
    await logActivity("asset", a.id, "utility_system", `Marked as a utility system (${KIND_LABELS[d.kind]})`, me.name);
  }
  revalidatePath("/buildings/utilities");
  return go(`/buildings/utilities?facilityId=${a.facilityId}&tab=systems`, `${a.tag} saved as a utility system.`);
}

const n = (label: string) => num(label, -1000, 100000);
const TestSchema = z.object({
  systemId: reqId("System"), kind: oneOf("Test", TEST_KINDS), testedOn: isoDate("Date"), notes: text(2000),
  loadKw: n("Load"), durationMin: n("Run time"), transferSec: n("Transfer time"), fuelPct: num("Fuel level", 0, 100), autonomyMin: n("Autonomy"),
  tempMin: num("Lowest temperature", -90, 60), tempMax: num("Highest temperature", -90, 60), excursionMin: num("Minutes out of range", 0, 100000),
  airChanges: num("Air changes", 0, 200), pressurePa: num("Pressure", -500, 500), checksOk: z.preprocess((v) => (v === "yes" ? true : v === "no" ? false : undefined), z.boolean().optional()),
});

export async function recordUtilityTestAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("maintenance.edit");
  const p = TestSchema.safeParse(formObject(fd));
  if (!p.success) return { error: firstError(p.error) };
  const d = p.data;
  if (!d.kind) return { error: "Choose the test." };
  const [s] = await db.select({ s: utilitySystems, tag: assets.assetTag }).from(utilitySystems).innerJoin(assets, eq(assets.id, utilitySystems.assetId)).where(eq(utilitySystems.id, d.systemId));
  if (!s) return { error: "That system no longer exists." };
  await requireFacilityAccess(s.s.facilityId, me);
  const today = todayISO();
  const testedOn = d.testedOn ?? today;
  if (testedOn > today) return { error: "The date can't be in the future.", fields: { testedOn: "Not in the future." } };
  const fields = TEST_FIELDS[d.kind];
  const r: Readings = {};
  for (const f of fields) if (f !== "checksOk") r[f] = d[f] ?? null;
  if (fields.includes("checksOk")) r.checksOk = d.checksOk ?? null;
  const j = judgeTest(s.s, d.kind, r);
  if (j.missing.length) return { error: `Fill in: ${j.missing.join(", ")}.` };
  const [t] = await db.insert(utilityTests).values({
    systemId: s.s.id, assetId: s.s.assetId, facilityId: s.s.facilityId, kind: d.kind, testedOn, ...r, checksOk: r.checksOk ?? null,
    passed: j.passed, problems: j.problems, notes: d.notes ?? null, byId: me.id, byName: me.name,
  }).returning({ id: utilityTests.id });
  await logActivity("asset", s.s.assetId, "utility_test", `${TEST_LABELS[d.kind]}: ${j.passed ? "passed" : `FAILED (${j.problems.slice(0, 2).join(" ")})`}`.slice(0, 300), me.name);
  revalidatePath("/buildings/utilities"); revalidatePath(`/assets/${s.s.assetId}`);
  const back = `/buildings/utilities?facilityId=${s.s.facilityId}`;
  if (j.passed) return go(back, `${s.tag}: ${TEST_LABELS[d.kind].toLowerCase()} passed and saved.`);
  const wo = await raiseFailureJob({
    assetId: s.s.assetId, facilityId: s.s.facilityId, tag: s.tag, title: failureTitle(d.kind, s.tag, j.problems),
    description: `${TEST_LABELS[d.kind]} on ${testedOn} by ${me.name} failed:\n${j.problems.join("\n")}${s.s.serves ? `\n\nServes: ${s.s.serves}` : ""}${d.notes ? `\n\n${d.notes}` : ""}`,
    priority: s.s.critical ? "URGENT" : "HIGH", deviceDown: false, me, source: `a failed ${TEST_LABELS[d.kind].toLowerCase()}`,
    link: async (tx, woId) => { await tx.update(utilityTests).set({ workOrderId: woId }).where(and(eq(utilityTests.id, t.id), eq(utilityTests.passed, false))); },
  });
  if (!wo) return go(`${back}&tab=tests`, `Test failed: ${j.problems.join(" ")} The system is kept as found, so no work order was opened.`.slice(0, 600), "error");
  return go(`/assets/work-orders/${wo.id}`, `Test failed: ${wo.number} opened for ${s.tag} and the biomedical team told.`);
}

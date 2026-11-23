"use server";
/**
 * X-ray and CT tubes (wave 38). Fitting a tube (the first one, or a replacement that closes the one in use) needs
 * `assets.edit`; a counter reading `maintenance.edit`. Rules in src/lib/assets/tubes.ts.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, tubeReadings, xrayTubes } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { isTubeType, TUBE_COUNTER_LABELS, TUBE_COUNTERS, tubeReadingProblem } from "@/lib/assets/tubes";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { CURRENCIES, formatDate, todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined);
const optNum = (label: string, min: number, max: number, int = false) => z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(String(b).replace(/,/g, "")); },
  (int ? z.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`) : z.number({ error: `${label} must be a number.` }))
    .min(min, `${label} must be at least ${min.toLocaleString("en")}.`).max(max, `${label} must be at most ${max.toLocaleString("en")}.`).optional());
const optText = (max: number) => z.preprocess(blank, z.string().max(max, `Keep this under ${max} characters.`).optional());
const date = (label: string) => z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`);
const strings = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));

const FitSchema = z.object({
  assetId: z.coerce.number().int().positive(),
  serialNumber: z.preprocess(blank, z.string({ error: "Enter the tube's serial number." }).max(80, "Keep the serial under 80 characters.")),
  maker: optText(80), model: optText(80),
  counterUnit: z.enum(TUBE_COUNTERS, { error: "Choose what the counter counts." }),
  installedOn: date("date it was fitted"),
  counterAtInstall: optNum("Counter when fitted", 0, 1e12),
  warrantyMonths: optNum("Warranty months", 1, 240, true), warrantyCounter: optNum("Warranty use", 1, 1e12), expectedLife: optNum("Expected life", 1, 1e12),
  cost: optNum("Cost", 0, 1e11), currency: z.preprocess(blank, z.enum(CURRENCIES).optional()),
  underWarranty: z.preprocess((v) => v === "on", z.boolean()),
  notes: optText(2000), removedReason: optText(500),
  oldCounter: optNum("The old tube's last counter", 0, 1e12),
});

export async function fitTubeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = FitSchema.safeParse(strings(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, code: deviceTypes.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, d.assetId));
  if (!a || !isTubeType(a.code)) return fail("Tubes are recorded on CT, X-ray, mammography and angiography devices only.");
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return fail("This device has been disposed of.");
  if (d.installedOn > todayISO()) return { errors: ["The date can't be in the future."], fields: { installedOn: "In the future." } };
  if (!d.warrantyMonths && !d.warrantyCounter && !d.expectedLife) return { errors: ["Enter the warranty or the expected life, so the tube can be forecast."], fields: { warrantyMonths: "Enter the warranty or the expected life." } };
  const [old] = await db.select().from(xrayTubes).where(and(eq(xrayTubes.assetId, a.id), isNull(xrayTubes.removedOn)));
  if (old && d.installedOn < old.installedOn) return { errors: [`The tube in use was fitted on ${formatDate(old.installedOn)}; the new one can't be fitted before that.`], fields: { installedOn: "Before the tube in use was fitted." } };
  if (old && d.oldCounter != null) {
    const existing = await db.select({ readOn: tubeReadings.readOn, counter: tubeReadings.counter }).from(tubeReadings).where(eq(tubeReadings.tubeId, old.id)).orderBy(asc(tubeReadings.readOn));
    const problem = tubeReadingProblem({ ...old }, existing, { readOn: d.installedOn, counter: d.oldCounter }, todayISO());
    if (problem) return { errors: [problem], fields: { oldCounter: problem } };
  }
  await db.transaction(async (tx) => {
    if (old) {
      if (d.oldCounter != null) await tx.insert(tubeReadings).values({ tubeId: old.id, readOn: d.installedOn, counter: d.oldCounter, note: "When the tube was removed", readByName: me.name });
      await tx.update(xrayTubes).set({ removedOn: d.installedOn, removedReason: d.removedReason ?? null }).where(eq(xrayTubes.id, old.id));
    }
    await tx.insert(xrayTubes).values({
      assetId: a.id, facilityId: a.facilityId, serialNumber: d.serialNumber, maker: d.maker ?? null, model: d.model ?? null, counterUnit: d.counterUnit,
      installedOn: d.installedOn, counterAtInstall: d.counterAtInstall ?? 0, warrantyMonths: d.warrantyMonths ?? null, warrantyCounter: d.warrantyCounter ?? null,
      expectedLife: d.expectedLife ?? null, cost: d.cost != null ? String(d.cost) : null, currency: d.cost != null ? d.currency ?? "EGP" : null,
      underWarranty: d.underWarranty, notes: d.notes ?? null,
    });
    await logActivity("asset", a.id, old ? "tube_replaced" : "tube_fitted",
      old ? `Tube ${old.serialNumber} replaced by ${d.serialNumber} on ${formatDate(d.installedOn)}${d.removedReason ? ` (${d.removedReason})` : ""}${d.underWarranty ? ", under warranty" : ""}`
        : `Tube ${d.serialNumber} recorded, fitted ${formatDate(d.installedOn)}`, me.name, tx);

  });
  revalidatePath(`/assets/${a.id}`);
  return { message: `${a.tag}: tube ${d.serialNumber} ${old ? "fitted; the old tube is in the history" : "recorded"}.` };
}

const ReadingSchema = z.object({
  tubeId: z.coerce.number().int().positive(), readOn: date("date"),
  counter: z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(String(b).replace(/,/g, "")); }, z.number({ error: "Enter the counter as shown on the service screen." })),
  note: optText(500),
});

export async function recordTubeReadingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = ReadingSchema.safeParse(strings(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [t] = await db.select({ t: xrayTubes, tag: assets.assetTag }).from(xrayTubes).innerJoin(assets, eq(assets.id, xrayTubes.assetId)).where(eq(xrayTubes.id, d.tubeId));
  if (!t) return fail("That tube is not on record.");
  await requireFacilityAccess(t.t.facilityId, me);
  const existing = await db.select({ readOn: tubeReadings.readOn, counter: tubeReadings.counter, id: tubeReadings.id }).from(tubeReadings).where(eq(tubeReadings.tubeId, t.t.id));
  const problem = tubeReadingProblem(t.t, existing, { readOn: d.readOn, counter: d.counter }, todayISO());
  if (problem) return { errors: [problem], fields: { [/date|fitted|removed/.test(problem) ? "readOn" : "counter"]: problem } };
  await db.insert(tubeReadings).values({ tubeId: t.t.id, readOn: d.readOn, counter: d.counter, note: d.note ?? null, readByName: me.name });
  const unit = TUBE_COUNTER_LABELS[t.t.counterUnit as keyof typeof TUBE_COUNTER_LABELS] ?? t.t.counterUnit;
  await logActivity("asset", t.t.assetId, "tube_reading", `Tube ${t.t.serialNumber}: ${d.counter.toLocaleString("en")} ${unit.toLowerCase()} on ${formatDate(d.readOn)}`, me.name);
  revalidatePath(`/assets/${t.t.assetId}`);
  return { message: `${t.tag}: counter ${d.counter.toLocaleString("en")} saved.` };
}

"use server";
/**
 * Usage meter actions (wave 27). Adding a reading needs `maintenance.edit` (technicians read the meters); setting a
 * device type's usage interval needs `catalogue.edit`.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { diff } from "@/lib/audit-diff";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes, meterReadings } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, int, oneOf, reqId, text } from "@/lib/assets/forms";
import { readingProblem, USAGE_UNITS, usageIntervalLabel } from "@/lib/assets/meters";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";
import { todayISO } from "@/lib/format";

const reqDate = (label: string) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined), z.string({ error: `Enter the ${label}.` }).regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label}.`));

const ReadingSchema = z.object({
  assetId: reqId("Device"), readOn: reqDate("date of the reading"),
  reading: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : undefined), z.number({ error: "Enter the meter reading." }).min(0, "Enter the meter reading as a number, 0 or more.").max(1e12, "That reading is too large.")),
  reset: z.preprocess((v) => v === "on" || v === "true", z.boolean()), note: text(500),
});

export async function addMeterReadingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = ReadingSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, facilityId: assets.facilityId, unit: deviceTypes.usageUnit, status: assets.status })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, d.assetId));
  if (!a) return fail("That device is not in the register.");
  await requireFacilityAccess(a.facilityId, me);
  if (!a.unit) return fail("This device type has no usage interval. Set one in the catalogue first.");
  if (d.readOn > todayISO()) return { errors: ["The date can't be in the future."], fields: { readOn: "This date is in the future." } };
  const existing = await db.select({ id: meterReadings.id, readOn: meterReadings.readOn, reading: meterReadings.reading, kind: meterReadings.kind })
    .from(meterReadings).where(eq(meterReadings.assetId, a.id)).orderBy(asc(meterReadings.readOn), asc(meterReadings.id));
  const kind = d.reset ? "RESET" as const : "READING" as const;
  const problem = readingProblem(existing, { readOn: d.readOn, reading: d.reading, kind });
  if (problem) return { errors: [problem], fields: { reading: problem } };
  await db.insert(meterReadings).values({ assetId: a.id, readOn: d.readOn, reading: d.reading, unit: a.unit, kind, note: d.note ?? null, enteredById: me.id, enteredByName: me.name });
  await logActivity("asset", a.id, "meter_reading", `${kind === "RESET" ? "New or reset meter" : "Meter reading"}: ${d.reading.toLocaleString("en-GB")} ${a.unit} on ${d.readOn}`, me.name);
  revalidatePath(`/assets/${a.id}`); revalidatePath("/assets/maintenance");
  return { message: "Reading saved." };
}

/* ── Wave 29: correct or delete a reading entered by mistake ── */

const FixSchema = z.object({ id: reqId("Reading"), readOn: reqDate("date of the reading"),
  reading: z.preprocess((v) => (typeof v === "string" && v.trim() ? Number(v) : undefined), z.number({ error: "Enter the meter reading." }).min(0, "Enter the meter reading as a number, 0 or more.")),
  reset: z.preprocess((v) => v === "on" || v === "true", z.boolean()), note: text(500) });

async function readingFor(id: number, me: Awaited<ReturnType<typeof requirePermission>>) {
  const [r] = await db.select().from(meterReadings).where(eq(meterReadings.id, id));
  if (!r) return null;
  const [a] = await db.select({ facilityId: assets.facilityId }).from(assets).where(eq(assets.id, r.assetId));
  await requireFacilityAccess(a.facilityId, me);
  return r;
}

export async function correctMeterReadingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = FixSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const before = await readingFor(d.id, me);
  if (!before) return fail("That reading no longer exists.");
  if (d.readOn > todayISO()) return { errors: ["The date can't be in the future."], fields: { readOn: "This date is in the future." } };
  const others = await db.select({ id: meterReadings.id, readOn: meterReadings.readOn, reading: meterReadings.reading, kind: meterReadings.kind })
    .from(meterReadings).where(and(eq(meterReadings.assetId, before.assetId), ne(meterReadings.id, d.id))).orderBy(asc(meterReadings.readOn), asc(meterReadings.id));
  const kind = d.reset ? "RESET" as const : "READING" as const;
  const problem = readingProblem(others, { readOn: d.readOn, reading: d.reading, kind });
  if (problem) return { errors: [problem], fields: { reading: problem } };
  const after = { readOn: d.readOn, reading: d.reading, kind, note: d.note ?? null };
  await db.update(meterReadings).set(after).where(eq(meterReadings.id, d.id));
  await logActivity("asset", before.assetId, "meter_reading_corrected", `Meter reading of ${before.readOn} corrected`, me.name, db,
    diff({ readOn: before.readOn, reading: before.reading, kind: before.kind, note: before.note }, after));
  revalidatePath(`/assets/${before.assetId}`); revalidatePath("/assets/maintenance");
  return { message: "Reading corrected." };
}

export async function deleteMeterReadingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const id = Number(fd.get("id"));
  const r = await readingFor(id, me);
  if (!r) return fail("That reading no longer exists.");
  // Taking a reading out must not leave the others going backwards.
  const rest = await db.select({ id: meterReadings.id, readOn: meterReadings.readOn, reading: meterReadings.reading, kind: meterReadings.kind })
    .from(meterReadings).where(and(eq(meterReadings.assetId, r.assetId), ne(meterReadings.id, id))).orderBy(asc(meterReadings.readOn), asc(meterReadings.id));
  for (let i = 1; i < rest.length; i++) {
    const problem = readingProblem(rest.slice(0, i), rest[i]);
    if (problem) return fail("Without this reading the others would go backwards. Correct it instead, or mark the later one as a new or reset meter.");
  }
  await db.delete(meterReadings).where(eq(meterReadings.id, id));
  await logActivity("asset", r.assetId, "meter_reading_deleted", `Meter reading deleted: ${r.reading.toLocaleString("en-GB")} ${r.unit} on ${r.readOn}${r.note ? ` (${r.note})` : ""}`, me.name);
  revalidatePath(`/assets/${r.assetId}`); revalidatePath("/assets/maintenance");
  return { message: "Reading deleted." };
}

const IntervalSchema = z.object({ code: z.string().min(1).max(48), usageInterval: int("Usage interval", 1, 100_000_000), usageUnit: oneOf("Unit", USAGE_UNITS) });

export async function setUsageIntervalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = IntervalSchema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  if (!!d.usageInterval !== !!d.usageUnit) {
    return d.usageInterval ? { errors: ["Choose what the meter counts."], fields: { usageUnit: "Choose a unit." } } : { errors: ["Enter how much use between visits."], fields: { usageInterval: "Enter a number." } };
  }
  const [t] = await db.select({ id: deviceTypes.id, level: deviceTypes.level, usageInterval: deviceTypes.usageInterval, usageUnit: deviceTypes.usageUnit }).from(deviceTypes).where(eq(deviceTypes.code, d.code));
  if (!t || t.level !== 3) return fail("Usage intervals are set on a device type.");
  const next = { usageInterval: d.usageInterval ?? null, usageUnit: d.usageUnit ?? null };
  await db.update(deviceTypes).set(next).where(eq(deviceTypes.id, t.id));
  const label = usageIntervalLabel(next.usageInterval, next.usageUnit);
  await logActivity("device_type", t.id, "updated", label ? `Planned maintenance also ${label}` : "Usage-based planned maintenance removed", me.name, undefined,
    { usageInterval: { from: t.usageInterval, to: next.usageInterval }, usageUnit: { from: t.usageUnit, to: next.usageUnit } });
  revalidatePath(`/catalogue/${d.code}`); revalidatePath("/assets/maintenance");
  return { message: label ? `Saved: planned maintenance is also due ${label}.` : "Saved: planned maintenance by months only." };
}

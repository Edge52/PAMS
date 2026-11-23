"use server";
/**
 * MRI cryogen log (wave 38). Recording a reading needs `maintenance.edit`; a magnet's thresholds `assets.edit`.
 * Rules in src/lib/assets/cryogen.ts.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, cryogenReadings, deviceTypes, mriMagnets } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { COLD_HEAD_STATES, COMPRESSOR_STATES, cryoReadingProblem, isMriType } from "@/lib/assets/cryogen";
import { fail, zodFail, type ActionState } from "@/lib/procurement/forms";
import { changeSummary, diff } from "@/lib/audit-diff";
import { formatDate, todayISO } from "@/lib/format";
import { logActivity } from "@/lib/server-utils";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v ?? undefined);
const optNum = (label: string) => z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); }, z.number({ error: `${label} must be a number.` }).optional());
const optEnum = <T extends string>(list: readonly T[]) => z.preprocess(blank, z.enum(list as unknown as [T, ...T[]]).optional());

const ReadingSchema = z.object({
  assetId: z.coerce.number({ error: "Choose the MRI scanner." }).int().positive("Choose the MRI scanner."),
  readOn: z.string({ error: "Enter the date." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."),
  heliumPct: z.preprocess((v) => { const b = blank(v); return b === undefined ? undefined : Number(b); }, z.number({ error: "Enter the helium level in %." })),
  pressurePsi: optNum("Pressure"), chillerTempC: optNum("Chiller temperature"),
  coldHead: optEnum(COLD_HEAD_STATES), compressor: optEnum(COMPRESSOR_STATES),
  remarks: z.preprocess(blank, z.string().max(1000, "Keep the remarks under 1,000 characters.").optional()),
  readBy: z.preprocess(blank, z.string().max(120, "Keep the name under 120 characters.").optional()),
});

async function mri(assetId: number) {
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, code: deviceTypes.code })
    .from(assets).innerJoin(deviceTypes, eq(deviceTypes.id, assets.deviceTypeId)).where(eq(assets.id, assetId));
  return a && isMriType(a.code) ? a : null;
}

export async function recordCryoReadingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("maintenance.edit");
  const p = ReadingSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const a = await mri(d.assetId);
  if (!a) return { errors: ["Choose an MRI scanner from the list."], fields: { assetId: "Not an MRI scanner." } };
  await requireFacilityAccess(a.facilityId, me);
  if (a.status === "DISPOSED") return fail("This scanner has been disposed of.");
  const problem = cryoReadingProblem(d, todayISO());
  if (problem) {
    const field = /Helium/.test(problem) ? "heliumPct" : /date/.test(problem) ? "readOn" : /Pressure/.test(problem) ? "pressurePsi" : "chillerTempC";
    return { errors: [problem], fields: { [field]: problem } };
  }
  await db.insert(cryogenReadings).values({
    assetId: a.id, facilityId: a.facilityId, readOn: d.readOn, heliumPct: d.heliumPct, pressurePsi: d.pressurePsi ?? null, coldHead: d.coldHead ?? null,
    compressor: d.compressor ?? null, chillerTempC: d.chillerTempC ?? null, remarks: d.remarks ?? null, readBy: d.readBy ?? me.name, recordedById: me.id,
  });
  await logActivity("asset", a.id, "cryogen_reading", `Helium ${d.heliumPct} % on ${formatDate(d.readOn)}${d.coldHead === "STOPPED" ? ", cold head stopped" : ""}`, me.name);
  revalidatePath(`/assets/${a.id}`);
  revalidatePath("/assets/cryogen");
  return { message: `${a.tag}: helium ${d.heliumPct} % on ${formatDate(d.readOn)} saved.` };
}

const tick = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const SettingsSchema = z.object({
  assetId: z.coerce.number().int().positive(), cryogenic: tick,
  heliumMinPct: z.coerce.number({ error: "Minimum level must be a number." }).min(0, "Minimum level must be 0–100 %.").max(100, "Minimum level must be 0–100 %."),
  maxDropPct: z.coerce.number({ error: "Allowed fall must be a number." }).gt(0, "Allowed fall must be more than 0.").max(100, "Allowed fall must be at most 100."),
  dropWindowDays: z.coerce.number({ error: "Days must be a number." }).int("Days must be a whole number.").min(1, "Days must be 1–365.").max(365, "Days must be 1–365."),
  maxGapDays: z.coerce.number({ error: "Days must be a number." }).int("Days must be a whole number.").min(1, "Days must be 1–90.").max(90, "Days must be 1–90."),
});

export async function saveMagnetSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = SettingsSchema.safeParse(Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")));
  if (!p.success) return zodFail(p.error);
  const a = await mri(p.data.assetId);
  if (!a) return fail("Not an MRI scanner.");
  await requireFacilityAccess(a.facilityId, me);
  const { assetId, ...v } = p.data;
  const [before] = await db.select().from(mriMagnets).where(eq(mriMagnets.assetId, assetId));
  await db.insert(mriMagnets).values({ assetId, ...v }).onConflictDoUpdate({ target: mriMagnets.assetId, set: v });
  const changes = before ? diff(before, { ...before, ...v }) : null;
  await logActivity("asset", a.id, "magnet_settings", `Helium log settings: ${v.cryogenic ? `minimum ${v.heliumMinPct} %, fall at most ${v.maxDropPct} in ${v.dropWindowDays} days, a reading every ${v.maxGapDays} days` : "not a helium magnet"}${changes ? `. ${changeSummary(changes)}` : ""}`, me.name, db, changes);
  revalidatePath(`/assets/${a.id}`);
  revalidatePath("/assets/cryogen");
  return { message: "Helium log settings saved." };
}

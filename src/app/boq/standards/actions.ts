"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqRules, boqs, departmentTypes, deviceTypes, standardSets } from "@/db/schema";
import { int, logActivity, str } from "@/lib/server-utils";
import { BASES, describeRatio, parseRatio, ROUNDINGS, TIERS } from "@/lib/boq/engine";
import { requirePermission } from "@/lib/auth/session";

const enc = encodeURIComponent;
const CONFIDENCES = ["SOURCED", "INDUSTRY_PRACTICE", "DRAFT"] as const;

function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${enc(message)}`);
}

const ruleSchema = z.object({
  departmentTypeCode: z.string().min(1, "Pick a department type"),
  deviceTypeId: z.number({ message: "Pick a device type" }).int().positive(),
  basis: z.enum(BASES),
  ratio: z.number({ message: "Enter the ratio as a number, e.g. 1, 0.5 or 1/100" }).min(0).max(10000),
  minQty: z.number().int().min(0).max(10000),
  maxQty: z.number().int().min(0).max(100000).nullable(),
  rounding: z.enum(ROUNDINGS),
  tier: z.enum(TIERS),
  confidence: z.enum(CONFIDENCES),
  sourceRef: z.string().max(64).nullable(),
  notes: z.string().max(2000).nullable(),
}).refine((r) => r.maxQty === null || r.maxQty >= r.minQty, { message: "Maximum must be at least the minimum", path: ["maxQty"] });

function readRule(fd: FormData) {
  const ratioText = str(fd, "ratio") ?? "";
  return ruleSchema.safeParse({
    departmentTypeCode: str(fd, "departmentTypeCode") ?? "",
    deviceTypeId: int(fd, "deviceTypeId") ?? undefined,
    basis: str(fd, "basis") ?? "",
    ratio: parseRatio(ratioText) ?? undefined,
    minQty: int(fd, "minQty") ?? 0,
    maxQty: int(fd, "maxQty"),
    rounding: str(fd, "rounding") ?? "CEIL",
    tier: str(fd, "tier") ?? "ESSENTIAL",
    confidence: str(fd, "confidence") ?? "DRAFT",
    sourceRef: str(fd, "sourceRef"),
    notes: str(fd, "notes"),
  });
}

async function deviceName(id: number) {
  const [d] = await db.select({ name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, id));
  return d;
}

export async function saveRule(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const ruleId = int(fd, "ruleId");
  const filter = str(fd, "dept");
  const back = `/boq/standards/${setId}${filter ? `?dept=${enc(filter)}` : ""}`;
  const parsed = readRule(fd);
  if (!parsed.success) fail(ruleId ? `${back}${filter ? "&" : "?"}edit=${ruleId}` : `${back}${filter ? "&" : "?"}add=1`, parsed.error.issues[0]?.message ?? "Check the rule");
  const v = parsed.data;
  const dev = await deviceName(v.deviceTypeId);
  if (!dev || dev.level !== 3) fail(back, "Pick a device type, not a category.");
  const [dt] = await db.select({ code: departmentTypes.code }).from(departmentTypes).where(eq(departmentTypes.code, v.departmentTypeCode));
  if (!dt) fail(back, "Unknown department type.");

  const dup = await db.select({ id: boqRules.id }).from(boqRules).where(and(
    eq(boqRules.standardSetId, setId), eq(boqRules.departmentTypeCode, v.departmentTypeCode), eq(boqRules.deviceTypeId, v.deviceTypeId),
    ...(ruleId ? [ne(boqRules.id, ruleId)] : []),
  ));
  if (dup.length) fail(back, `There is already a rule for ${dev.name} in ${v.departmentTypeCode}. Edit that one instead.`);

  const readable = describeRatio(v.basis, v.ratio);
  if (ruleId) {
    await db.update(boqRules).set(v).where(and(eq(boqRules.id, ruleId), eq(boqRules.standardSetId, setId)));
    await logActivity("standard_set", setId, "rule_updated", `${v.departmentTypeCode} · ${dev.name}: ${readable}`);
  } else {
    await db.insert(boqRules).values({ ...v, standardSetId: setId });
    await logActivity("standard_set", setId, "rule_added", `${v.departmentTypeCode} · ${dev.name}: ${readable}`);
  }
  revalidatePath(`/boq/standards/${setId}`);
  revalidatePath("/boq/standards");
  redirect(`${back}${filter ? "&" : "?"}notice=${enc(`${ruleId ? "Updated" : "Added"} ${dev.name} in ${v.departmentTypeCode}: ${readable}. Regenerate BOQs to apply it.`)}#rule-${v.departmentTypeCode}`);
}

export async function deleteRule(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const ruleId = int(fd, "ruleId") ?? 0;
  const filter = str(fd, "dept");
  const back = `/boq/standards/${setId}${filter ? `?dept=${enc(filter)}` : ""}`;
  const [r] = await db.select().from(boqRules).where(and(eq(boqRules.id, ruleId), eq(boqRules.standardSetId, setId)));
  if (!r) fail(back, "That rule was already deleted.");
  const dev = await deviceName(r.deviceTypeId);
  await db.delete(boqRules).where(eq(boqRules.id, ruleId));
  await logActivity("standard_set", setId, "rule_deleted", `${r.departmentTypeCode} · ${dev?.name}: ${describeRatio(r.basis, r.ratio)}`);
  revalidatePath(`/boq/standards/${setId}`);
  redirect(`${back}${filter ? "&" : "?"}notice=${enc(`Deleted the ${dev?.name ?? ""} rule from ${r.departmentTypeCode}.`)}`);
}

export async function duplicateSet(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const [src] = await db.select().from(standardSets).where(eq(standardSets.id, setId));
  if (!src) fail("/boq/standards", "That standard set no longer exists.");
  const name = str(fd, "name") ?? `${src.name} (copy)`;
  const base = (str(fd, "code") ?? `${src.code}-COPY`).toUpperCase().replace(/[^A-Z0-9-]+/g, "-").slice(0, 40);
  const existing = new Set((await db.select({ code: standardSets.code }).from(standardSets)).map((r) => r.code));
  let code = base, n = 2;
  while (existing.has(code)) code = `${base}-${n++}`;

  const newId = await db.transaction(async (tx) => {
    const [copy] = await tx.insert(standardSets).values({
      code, name, description: src.description ? `${src.description} (Copied from ${src.name}.)` : `Copied from ${src.name}.`,
      version: "1.0", sources: src.sources, isDefault: false,
    }).returning({ id: standardSets.id });
    const rules = await tx.select().from(boqRules).where(eq(boqRules.standardSetId, setId));
    if (rules.length) await tx.insert(boqRules).values(rules.map(({ id: _id, ...r }) => { void _id; return { ...r, standardSetId: copy.id }; }));
    return copy.id;
  });
  await logActivity("standard_set", newId, "created", `Duplicated from ${src.name} (${src.code}).`);
  revalidatePath("/boq/standards");
  redirect(`/boq/standards/${newId}?notice=${enc(`Created "${name}" with all of ${src.name}'s rules. Edit it freely — the original is unchanged.`)}`);
}

export async function setDefaultSet(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const [s] = await db.select().from(standardSets).where(eq(standardSets.id, setId));
  if (!s) fail("/boq/standards", "That standard set no longer exists.");
  await db.transaction(async (tx) => {
    await tx.update(standardSets).set({ isDefault: false }).where(ne(standardSets.id, setId));
    await tx.update(standardSets).set({ isDefault: true }).where(eq(standardSets.id, setId));
  });
  await logActivity("standard_set", setId, "set_default", `${s.name} is now the default standard set.`);
  revalidatePath("/boq/standards");
  const back = str(fd, "back") === "list" ? "/boq/standards" : `/boq/standards/${setId}`;
  redirect(`${back}?notice=${enc(`${s.name} is now the default for new BOQs.`)}`);
}

const setSchema = z.object({
  name: z.string().trim().min(2, "Give the set a name"),
  version: z.string().trim().min(1).max(16),
  description: z.string().nullable(),
});

export async function updateSet(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const parsed = setSchema.safeParse({ name: str(fd, "name") ?? "", version: str(fd, "version") ?? "1.0", description: str(fd, "description") });
  if (!parsed.success) fail(`/boq/standards/${setId}`, parsed.error.issues[0]?.message ?? "Check the details");
  await db.update(standardSets).set(parsed.data).where(eq(standardSets.id, setId));
  await logActivity("standard_set", setId, "updated", `Details updated: ${parsed.data.name} v${parsed.data.version}.`);
  revalidatePath(`/boq/standards/${setId}`);
  redirect(`/boq/standards/${setId}?notice=${enc("Details saved.")}`);
}

export async function deleteSet(fd: FormData) {
  await requirePermission("standards.edit");
  const setId = int(fd, "setId") ?? 0;
  const [s] = await db.select().from(standardSets).where(eq(standardSets.id, setId));
  if (!s) redirect("/boq/standards");
  if (s.isDefault) fail(`/boq/standards/${setId}`, "Make another set the default before deleting this one.");
  const used = await db.select({ id: boqs.id }).from(boqs).where(eq(boqs.standardSetId, setId)).limit(1);
  if (used.length) fail(`/boq/standards/${setId}`, "BOQs were generated from this set, so it can't be deleted. Duplicate it to start a new one instead.");
  await db.delete(standardSets).where(eq(standardSets.id, setId));
  await logActivity("standard_set", setId, "deleted", `${s.name} deleted.`);
  revalidatePath("/boq/standards");
  redirect(`/boq/standards?notice=${enc(`Deleted ${s.name}.`)}`);
}

"use server";
/**
 * BOQ quick start: preview (the engine run in memory, nothing saved) and create (a draft BOQ generated from the
 * answers, exactly as if the departments had been typed in by hand).
 */
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { boqDepartments, boqs, deviceTypes, standardSets } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { generateLines, HOSPITAL_WIDE, needsHospitalWideDepartment, type DepartmentInput, type Tier } from "@/lib/boq/engine";
import { loadCompanions, loadRules, regenerateBoq } from "@/lib/boq/generate";
import { PRICE_TIERS, scenarioTotals, tierPriceUsd } from "@/lib/boq/pricing";
import { cleanFeatures } from "@/lib/boq/questions";
import { buildScope, HOSPITAL_TYPES, type QuickStartAnswers } from "@/lib/boq/templates";
import { CURRENCIES } from "@/lib/format";
import { convert, logActivity } from "@/lib/server-utils";

const n = (max: number) => z.coerce.number().int().min(0).max(max);
const AnswersSchema = z.object({
  name: z.string().trim().max(200),
  type: z.enum(HOSPITAL_TYPES),
  ownership: z.enum(["government", "private"]),
  totalBeds: n(5000), icuBeds: n(1000), ccuBeds: n(1000), nicuBeds: n(1000), isolationBeds: n(1000),
  services: z.object({
    emergency: z.boolean(), theatres: n(100), cathLab: z.boolean(), ct: z.boolean(), mri: z.boolean(), mammography: z.boolean(),
    laboratory: z.boolean(), dialysisChairs: n(500), deliveriesPerYear: n(100000), clinics: n(500), endoscopy: z.boolean(),
    pharmacy: z.boolean(), sterileServices: z.boolean(), physiotherapy: z.boolean(),
  }),
  features: z.array(z.string()).max(20),
  priceTier: z.enum(PRICE_TIERS),
  targetBudget: z.coerce.number().min(0).max(1e12).nullable(),
  currency: z.enum(CURRENCIES),
  facilityId: z.number().int().positive().nullable(),
});

function parse(raw: unknown): { ok: true; a: QuickStartAnswers } | { ok: false; error: string } {
  const p = AnswersSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the answers." };
  return { ok: true, a: { ...p.data, features: cleanFeatures(p.data.features) } };
}

export type Preview = {
  error?: string;
  problems?: string[];
  standardSet?: string;
  departments?: { label: string; beds: number; rooms: number; lines: number; total: number }[];
  lines?: number; units?: number;
  byTier?: Record<(typeof PRICE_TIERS)[number], number>;
  chosen?: number; contingencyPct?: number;
  top?: { name: string; qty: number; amount: number; why: string }[];
  conditional?: number; companions?: number; unpriced?: number;
  assumptions?: string[]; currency?: string; targetBudget?: number | null;
};

const CONTINGENCY = 5;
const INCLUDE: Tier[] = ["ESSENTIAL", "RECOMMENDED"];

/** Run the standard on the answers without saving anything. */
export async function previewQuickStartAction(raw: unknown): Promise<Preview> {
  await requirePermission("boq.edit");
  const r = parse(raw);
  if (!r.ok) return { error: r.error };
  const a = r.a;
  const scope = buildScope(a);
  if (scope.problems.length) return { problems: scope.problems };
  const [set] = await db.select().from(standardSets).where(eq(standardSets.code, scope.standardSet));
  const [fallback] = set ? [set] : await db.select().from(standardSets).where(eq(standardSets.isDefault, true));
  if (!fallback) return { error: "No BOQ standard is loaded. Ask an administrator to load the standards." };
  const rules = await loadRules(db, fallback.id);
  let depts: DepartmentInput[] = scope.departments.map((d, i) => ({ id: i + 1, ...d }));
  if (needsHospitalWideDepartment({ rules, departments: depts, includeTiers: INCLUDE })) {
    depts = [...depts, { id: depts.length + 1, departmentTypeCode: HOSPITAL_WIDE, label: "Hospital-wide (shared)", beds: 0, rooms: 0, instances: 1, params: {} }];
  }
  const companions = await loadCompanions(db, rules.map((x) => x.deviceTypeId));
  const ids = [...new Set([...rules.map((x) => x.deviceTypeId), ...companions.map((c) => c.companionTypeId)])];
  const info = new Map((ids.length ? await db.select({ id: deviceTypes.id, name: deviceTypes.name, min: deviceTypes.priceMinUsd, max: deviceTypes.priceMaxUsd })
    .from(deviceTypes).where(inArray(deviceTypes.id, ids)) : []).map((x) => [x.id, x]));
  const lines = generateLines({
    rules, departments: depts, totalHospitalBeds: a.totalBeds, includeTiers: INCLUDE, features: a.features, companions,
    deviceName: (id) => info.get(id)?.name ?? `device #${id}`,
  });
  const rate = a.currency === "USD" ? 1 : await convert(1, "USD", a.currency);
  if (rate == null) return { error: `No exchange rate from USD to ${a.currency}. Add one under exchange rates, or choose USD.` };
  const toLocal = (usd: number) => Math.round(usd * rate);
  const sc = scenarioTotals(lines.map((l) => ({ quantity: l.calculatedQty, min: info.get(l.deviceTypeId)?.min ?? null, max: info.get(l.deviceTypeId)?.max ?? null, currentPrice: null, priceManual: false })), (x) => x, CONTINGENCY);
  const amount = (l: (typeof lines)[number]) => l.calculatedQty * (tierPriceUsd(info.get(l.deviceTypeId)?.min, info.get(l.deviceTypeId)?.max, a.priceTier) ?? 0);
  const deptRows = depts.map((d) => {
    const own = lines.filter((l) => l.boqDepartmentId === d.id);
    return { label: d.label, beds: d.beds, rooms: d.rooms, lines: own.length, total: toLocal(own.reduce((t, l) => t + amount(l), 0)) };
  }).filter((d) => d.lines > 0).sort((x, y) => y.total - x.total);
  return {
    standardSet: fallback.name, departments: deptRows, lines: lines.length, units: lines.reduce((t, l) => t + l.calculatedQty, 0),
    byTier: Object.fromEntries(PRICE_TIERS.map((t) => [t, toLocal(sc.byTier[t].total)])) as Preview["byTier"],
    chosen: toLocal(sc.byTier[a.priceTier].total), contingencyPct: CONTINGENCY,
    top: [...lines].sort((x, y) => amount(y) - amount(x)).slice(0, 8).map((l) => ({ name: info.get(l.deviceTypeId)?.name ?? "?", qty: l.calculatedQty, amount: toLocal(amount(l)), why: l.explanation })),
    conditional: lines.filter((l) => l.ruleId != null && rules.find((x) => x.id === l.ruleId)?.condition).length,
    companions: lines.filter((l) => l.ruleId == null).length, unpriced: sc.unpriced,
    assumptions: scope.assumptions, currency: a.currency, targetBudget: a.targetBudget,
  };
}

/** Create the draft BOQ from the answers and generate its lines. */
export async function createQuickStartAction(raw: unknown): Promise<{ error?: string }> {
  const me = await requirePermission("boq.edit");
  const r = parse(raw);
  if (!r.ok) return { error: r.error };
  const a = r.a;
  if (a.name.length < 2) return { error: "Give the BOQ a name." };
  if (a.facilityId) await requireFacilityAccess(a.facilityId, me);
  const scope = buildScope(a);
  if (scope.problems.length) return { error: scope.problems[0] };
  const [set] = await db.select().from(standardSets).where(eq(standardSets.code, scope.standardSet));
  const [fallback] = set ? [set] : await db.select().from(standardSets).where(eq(standardSets.isDefault, true));
  if (!fallback) return { error: "No BOQ standard is loaded." };
  const [boq] = await db.insert(boqs).values({
    name: a.name, facilityId: a.facilityId, standardSetId: fallback.id, totalHospitalBeds: a.totalBeds, currency: a.currency,
    contingencyPct: CONTINGENCY, includeTiers: INCLUDE, features: a.features, priceTier: a.priceTier,
    targetBudget: a.targetBudget ? a.targetBudget.toFixed(2) : null,
    notes: `Created with the quick start (${a.type === "womenChildren" ? "women and children's" : a.type} hospital, ${a.ownership}).\nAssumptions:\n- ${scope.assumptions.join("\n- ")}`,
  }).returning({ id: boqs.id });
  await db.insert(boqDepartments).values(scope.departments.map((d) => ({ ...d, boqId: boq.id })));
  const res = await regenerateBoq(db, boq.id, convert);
  await logActivity("boq", boq.id, "created", `Created with the quick start: ${scope.departments.length} departments, ${res.plan.counts.added} lines.`, me.name);
  revalidatePath("/boq");
  redirect(`/boq/${boq.id}?notice=${encodeURIComponent(`Quick start done: ${res.plan.counts.added} lines in ${scope.departments.length} departments. Review the quantities and prices, then submit for approval.`)}`);
}

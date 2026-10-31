/**
 * BOQ generation against the database. Takes the db handle as a parameter and imports nothing server-only,
 * so the app (server actions) and the seed script (tsx) share exactly the same code path.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  boqDepartments, boqLines, boqRules, boqs, departments, deviceCompanions, deviceTypes, rooms,
} from "@/db/schema";
import {
  generateLines, HOSPITAL_WIDE, mergeRegeneration, needsHospitalWideDepartment, summarizeMerge,
  type CompanionInput, type ExistingLine, type MergePlan, type RuleInput, type Tier,
} from "./engine";
import { tierPriceUsd, type PriceTier } from "./pricing";

/** Signature of convert() from @/lib/server-utils — injected so this module stays free of server-only imports. */
export type ConvertFn = (amount: number, from: string, to: string) => Promise<number | null>;

/** Room types that are not counted as "rooms" when importing scope from a facility. */
export const NON_CLINICAL_ROOM_TYPES = ["CORRIDOR", "NURSE_STATION", "STORE", "WAITING", "OFFICE", "TECHNICAL"] as const;

export interface ScopeRow {
  departmentTypeCode: string;
  departmentId: number | null;
  label: string;
  beds: number;
  rooms: number;
  instances: number;
}

/** A facility's departments as BOQ scope rows: beds from departments.beds, rooms = clinical rooms only. */
export async function facilityScope(d: DB, facilityId: number): Promise<ScopeRow[]> {
  const rows = await d
    .select({
      id: departments.id, type: departments.departmentTypeCode, name: departments.name, beds: departments.beds,
      rooms: sql<number>`count(${rooms.id}) filter (where ${rooms.type} not in (${sql.join(
        NON_CLINICAL_ROOM_TYPES.map((t) => sql`${t}`), sql`, `)}))::int`,
    })
    .from(departments)
    .leftJoin(rooms, eq(rooms.departmentId, departments.id))
    .where(eq(departments.facilityId, facilityId))
    .groupBy(departments.id)
    .orderBy(departments.id);
  return rows
    .filter((r) => r.type)
    .map((r) => ({ departmentTypeCode: r.type!, departmentId: r.id, label: r.name, beds: r.beds, rooms: r.rooms, instances: 1 }));
}

export async function loadRules(d: DB, standardSetId: number): Promise<RuleInput[]> {
  const rows = await d.select().from(boqRules).where(eq(boqRules.standardSetId, standardSetId));
  return rows.map((r) => ({
    id: r.id, departmentTypeCode: r.departmentTypeCode, deviceTypeId: r.deviceTypeId, basis: r.basis, ratio: r.ratio,
    minQty: r.minQty, maxQty: r.maxQty, rounding: r.rounding, tier: r.tier,
    param: r.param, paramRatio: r.paramRatio, condition: r.condition,
  }));
}

/** Companion pairs for these main devices (catalogue-wide). */
export async function loadCompanions(d: DB, deviceTypeIds: number[]): Promise<CompanionInput[]> {
  if (!deviceTypeIds.length) return [];
  return d.select({ deviceTypeId: deviceCompanions.deviceTypeId, companionTypeId: deviceCompanions.companionTypeId, ratio: deviceCompanions.ratio })
    .from(deviceCompanions).where(inArray(deviceCompanions.deviceTypeId, [...new Set(deviceTypeIds)]));
}

export interface PriceResult { price: string | null; usdFallback: boolean }

/** Default unit price per device type: midpoint of the USD band converted to `currency` (USD kept if no rate). */
export async function defaultUnitPrices(d: DB, deviceTypeIds: number[], currency: string, convert: ConvertFn, tier: PriceTier = "STANDARD") {
  const out = new Map<number, PriceResult>();
  if (deviceTypeIds.length === 0) return out;
  const rows = await d.select({ id: deviceTypes.id, min: deviceTypes.priceMinUsd, max: deviceTypes.priceMaxUsd })
    .from(deviceTypes).where(inArray(deviceTypes.id, [...new Set(deviceTypeIds)]));
  const rate = currency === "USD" ? 1 : await convert(1, "USD", currency);
  for (const r of rows) {
    const mid = tierPriceUsd(r.min, r.max, tier);
    if (mid === null) { out.set(r.id, { price: null, usdFallback: false }); continue; }
    if (rate === null) { out.set(r.id, { price: mid.toFixed(2), usdFallback: true }); continue; }
    out.set(r.id, { price: (Math.round(mid * rate * 100) / 100).toFixed(2), usdFallback: false });
  }
  return out;
}

export const USD_FALLBACK_NOTE = "Estimate kept in USD — no exchange rate for the BOQ currency.";

export interface GenerationResult { plan: MergePlan; summary: string; createdHospitalWide: boolean }

/**
 * (Re)generate a BOQ's rule lines from its standard set and department scope.
 * Creates the hospital-wide department when HOSP rules apply, merges with existing lines (overrides and manual
 * lines are preserved), prices new or unpriced lines, and returns a plain-language summary.
 */
export async function regenerateBoq(d: DB, boqId: number, convert: ConvertFn): Promise<GenerationResult> {
  const [boq] = await d.select().from(boqs).where(eq(boqs.id, boqId));
  if (!boq) throw new Error(`BOQ ${boqId} not found`);
  const rules = await loadRules(d, boq.standardSetId);
  let depts = await d.select().from(boqDepartments).where(eq(boqDepartments.boqId, boqId)).orderBy(boqDepartments.id);
  const includeTiers = boq.includeTiers as Tier[];

  let createdHospitalWide = false;
  if (needsHospitalWideDepartment({ rules, departments: depts, includeTiers })) {
    await d.insert(boqDepartments).values({ boqId, departmentTypeCode: HOSPITAL_WIDE, label: "Hospital-wide (shared)", beds: 0, rooms: 0, instances: 1 });
    createdHospitalWide = true;
    depts = await d.select().from(boqDepartments).where(eq(boqDepartments.boqId, boqId)).orderBy(boqDepartments.id);
  }

  const companions = await loadCompanions(d, rules.map((r) => r.deviceTypeId));
  const nameRows = companions.length
    ? await d.select({ id: deviceTypes.id, name: deviceTypes.name }).from(deviceTypes).where(inArray(deviceTypes.id, [...new Set(companions.map((c) => c.deviceTypeId))]))
    : [];
  const mainNames = new Map(nameRows.map((r) => [r.id, r.name]));
  const calculated = generateLines({
    rules, departments: depts, totalHospitalBeds: boq.totalHospitalBeds, includeTiers,
    features: boq.features, companions, deviceName: (id) => mainNames.get(id) ?? `device #${id}`,
  });
  const existingRows = await d.select().from(boqLines).where(eq(boqLines.boqId, boqId));
  const existing: ExistingLine[] = existingRows.map((l) => ({
    id: l.id, boqDepartmentId: l.boqDepartmentId, deviceTypeId: l.deviceTypeId, ruleId: l.ruleId, tier: l.tier,
    calculatedQty: l.calculatedQty, quantity: l.quantity, isOverridden: l.isOverridden, isManual: l.isManual, calcExplanation: l.calcExplanation,
  }));
  const plan = mergeRegeneration(existing, calculated);

  const unpricedIds = new Set(existingRows.filter((l) => l.unitPriceEstimate === null).map((l) => l.id));
  const needPrice = [
    ...plan.inserts.map((i) => i.deviceTypeId),
    ...existingRows.filter((l) => unpricedIds.has(l.id)).map((l) => l.deviceTypeId),
  ];
  // Price at each line's tier: the department's, else the BOQ's (one lookup per tier in use).
  const deptTier = new Map(depts.map((x) => [x.id, (x.priceTier ?? boq.priceTier) as PriceTier]));
  const tierOfDept = (id: number | null) => (id != null ? deptTier.get(id) : undefined) ?? (boq.priceTier as PriceTier);
  const priceByTier = new Map<PriceTier, Awaited<ReturnType<typeof defaultUnitPrices>>>();
  for (const t of new Set([...plan.inserts.map((i) => tierOfDept(i.boqDepartmentId)), ...existingRows.filter((l) => unpricedIds.has(l.id)).map((l) => (l.priceTier as PriceTier | null) ?? tierOfDept(l.boqDepartmentId))])) {
    priceByTier.set(t, await defaultUnitPrices(d, needPrice, boq.currency, convert, t));
  }
  const prices = { get: (deviceTypeId: number, t: PriceTier) => priceByTier.get(t)?.get(deviceTypeId) };

  await d.transaction(async (tx) => {
    if (plan.deletes.length) await tx.delete(boqLines).where(inArray(boqLines.id, plan.deletes));
    for (const u of plan.updates) {
      const row = existingRows.find((l) => l.id === u.id)!;
      const p = unpricedIds.has(u.id) ? prices.get(row.deviceTypeId, (row.priceTier as PriceTier | null) ?? tierOfDept(row.boqDepartmentId)) : undefined;
      await tx.update(boqLines).set({
        calculatedQty: u.calculatedQty, quantity: u.quantity, tier: u.tier, ruleId: u.ruleId, calcExplanation: u.calcExplanation,
        ...(p?.price ? { unitPriceEstimate: p.price } : {}),
        ...(p?.usdFallback && !row.notes ? { notes: USD_FALLBACK_NOTE } : {}),
      }).where(eq(boqLines.id, u.id));
    }
    if (plan.inserts.length) {
      await tx.insert(boqLines).values(plan.inserts.map((c) => {
        const p = prices.get(c.deviceTypeId, tierOfDept(c.boqDepartmentId));
        return {
          boqId, boqDepartmentId: c.boqDepartmentId, deviceTypeId: c.deviceTypeId, ruleId: c.ruleId, tier: c.tier,
          calculatedQty: c.calculatedQty, quantity: c.calculatedQty, isOverridden: false, isManual: false,
          unitPriceEstimate: p?.price ?? null, calcExplanation: c.explanation, notes: p?.usdFallback ? USD_FALLBACK_NOTE : null,
        };
      }));
    }
    await tx.update(boqs).set({ updatedAt: new Date() }).where(eq(boqs.id, boqId));
  });

  // Names for the summary.
  const deviceIds = [...new Set(plan.changes.map((c) => c.deviceTypeId))];
  const devNames = new Map<number, string>();
  if (deviceIds.length) {
    for (const r of await d.select({ id: deviceTypes.id, name: deviceTypes.name }).from(deviceTypes).where(inArray(deviceTypes.id, deviceIds))) devNames.set(r.id, r.name);
  }
  const deptNames = new Map(depts.map((x) => [x.id, x.label]));
  let summary = summarizeMerge(plan, {
    department: (id) => (id === null ? "Unassigned" : deptNames.get(id) ?? "Removed department"),
    device: (id) => devNames.get(id) ?? `Device #${id}`,
  });
  if (createdHospitalWide) summary = `Added a "Hospital-wide (shared)" department for hospital-level rules.\n${summary}`;
  return { plan, summary, createdHospitalWide };
}

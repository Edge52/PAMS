import "server-only";
/**
 * Procurement data access shared by pages and actions: FX factors, RFQ line derivation, comparison loading,
 * totals. Pure maths lives in scoring.ts / po-status.ts / receipt.ts.
 */
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests, boqDepartments, boqLines, boqs, departments, deviceTypes, offerCompliance, offerLines, offers, poLines, projects, purchaseOrders,
  rfqs, rfqLines as rfqLineRows, specItems, suppliers, techSpecs,
} from "@/db/schema";
import { lineTotal, num, round2 } from "@/lib/format";
import { convert, logActivity } from "@/lib/server-utils";
import { advanceTo, EXCLUDED_OFFER_STATUSES, humanizeEnum } from "./labels";
import {
  evaluateProject, normalizeWeights, type ComplianceMap, type ComplianceStatus, type FxFactors, type RowInput, type Weights,
} from "./scoring";

/* ───────────── FX ───────────── */

/** Multiplier from each currency to `to` (null when a rate is missing). Uses the shared convert() seam. */
export async function fxFactors(currencies: Iterable<string>, to: string): Promise<FxFactors> {
  const out: FxFactors = {};
  await Promise.all([...new Set(currencies)].map(async (c) => { out[c] = await convert(1, c, to); }));
  return out;
}

/** Sum amounts in mixed currencies into one currency. total is null if any rate is missing. */
export async function sumInCurrency(amounts: { amount: number; currency: string }[], to: string) {
  const fx = await fxFactors(amounts.map((a) => a.currency), to);
  let total = 0;
  const missing = new Set<string>();
  for (const a of amounts) {
    const f = fx[a.currency];
    if (f == null) missing.add(a.currency); else total += a.amount * f;
  }
  return { total: missing.size ? null : round2(total), partial: round2(total), missing: [...missing] };
}

/* ───────────── Device types ───────────── */

export async function deviceTypeOptions() {
  const rows = await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name, parentId: deviceTypes.parentId })
    .from(deviceTypes).where(and(eq(deviceTypes.level, 3), eq(deviceTypes.active, true))).orderBy(asc(deviceTypes.code));
  return rows;
}

/* ───────────── Specifications ───────────── */

export type SpecWithItems = typeof techSpecs.$inferSelect & { items: (typeof specItems.$inferSelect)[] };

/** The current spec per device type for a project (latest id wins if several exist). */
export async function projectSpecs(projectId: number): Promise<Map<number, SpecWithItems>> {
  const specs = await db.select().from(techSpecs).where(eq(techSpecs.projectId, projectId)).orderBy(desc(techSpecs.id));
  const items = specs.length
    ? await db.select().from(specItems).where(inArray(specItems.specId, specs.map((s) => s.id))).orderBy(asc(specItems.sortOrder), asc(specItems.id))
    : [];
  const map = new Map<number, SpecWithItems>();
  for (const s of specs) {
    if (map.has(s.deviceTypeId)) continue;
    map.set(s.deviceTypeId, { ...s, items: items.filter((i) => i.specId === s.id) });
  }
  return map;
}

/* ───────────── RFQ lines (derived) ───────────── */

const SCOPE_MARK = "[scope]";

/** RFQ scope is kept in the notes as a marker line until an rfq_lines table exists. */
export function splitRfqNotes(notes: string | null): { text: string; scope: string[] | null } {
  if (!notes) return { text: "", scope: null };
  const lines = notes.split("\n");
  const markerIdx = lines.findIndex((l) => l.startsWith(SCOPE_MARK));
  if (markerIdx < 0) return { text: notes.trim(), scope: null };
  const scope = lines[markerIdx].slice(SCOPE_MARK.length).split(",").map((s) => s.trim()).filter(Boolean);
  lines.splice(markerIdx, 1);
  return { text: lines.join("\n").trim(), scope };
}
export function joinRfqNotes(text: string | null | undefined, scope: string[] | null): string | null {
  const parts = [text?.trim() ?? ""];
  if (scope && scope.length) parts.push(`${SCOPE_MARK} ${scope.join(", ")}`);
  const out = parts.filter(Boolean).join("\n\n");
  return out || null;
}

export type BoqGroup = {
  deviceTypeId: number; code: string; name: string; quantity: number; estimate: number | null;
  lines: { id: number; quantity: number; department: string | null; tier: string }[];
};

/** BOQ lines grouped by device type with summed quantities (the RFQ / offer pre-fill contract with the BOQ module). */
export async function boqGroups(boqId: number): Promise<BoqGroup[]> {
  const rows = await db.select({
    id: boqLines.id, deviceTypeId: boqLines.deviceTypeId, quantity: boqLines.quantity, tier: boqLines.tier,
    estimate: boqLines.unitPriceEstimate, code: deviceTypes.code, name: deviceTypes.name, department: boqDepartments.label,
  }).from(boqLines)
    .innerJoin(deviceTypes, eq(deviceTypes.id, boqLines.deviceTypeId))
    .leftJoin(boqDepartments, eq(boqDepartments.id, boqLines.boqDepartmentId))
    .where(eq(boqLines.boqId, boqId))
    .orderBy(asc(deviceTypes.code), asc(boqLines.id));
  const groups = new Map<number, BoqGroup>();
  for (const r of rows) {
    const g = groups.get(r.deviceTypeId) ?? { deviceTypeId: r.deviceTypeId, code: r.code, name: r.name, quantity: 0, estimate: null, lines: [] };
    g.quantity += r.quantity;
    if (r.estimate != null) g.estimate = (g.estimate ?? 0) + num(r.estimate) * r.quantity;
    g.lines.push({ id: r.id, quantity: r.quantity, department: r.department, tier: r.tier });
    groups.set(r.deviceTypeId, g);
  }
  return [...groups.values()].filter((g) => g.quantity > 0);
}

export type RfqLine = {
  deviceTypeId: number; code: string; name: string; quantity: number | null;
  departments: string[]; boqLineIds: number[]; specId: number | null; specItemCount: number;
};

/**
 * Lines of an RFQ. RFQs store a snapshot of their lines (rfq_lines) when created, so quantities don't move if the BOQ is
 * regenerated later. RFQs created before that table existed fall back to deriving lines live.
 */
export async function rfqLines(rfq: typeof rfqs.$inferSelect): Promise<RfqLine[]> {
  const specs = await projectSpecs(rfq.projectId);
  const stored = await db.select({ l: rfqLineRows, code: deviceTypes.code, name: deviceTypes.name }).from(rfqLineRows)
    .innerJoin(deviceTypes, eq(deviceTypes.id, rfqLineRows.deviceTypeId))
    .where(eq(rfqLineRows.rfqId, rfq.id)).orderBy(asc(rfqLineRows.sortOrder), asc(rfqLineRows.id));
  if (stored.length) {
    return stored.map(({ l, code, name }) => ({
      deviceTypeId: l.deviceTypeId, code, name, quantity: l.quantity, departments: l.departments, boqLineIds: l.boqLineIds,
      specId: specs.get(l.deviceTypeId)?.id ?? null, specItemCount: specs.get(l.deviceTypeId)?.items.length ?? 0,
    }));
  }
  return deriveRfqLines(rfq, specs);
}

/** Lines derived live from the RFQ's BOQ (filtered to its scope) or, without a BOQ, from the project's specifications. */
export async function deriveRfqLines(
  rfq: Pick<typeof rfqs.$inferSelect, "projectId" | "boqId" | "notes">,
  specsIn?: Map<number, SpecWithItems>,
): Promise<RfqLine[]> {
  const specs = specsIn ?? await projectSpecs(rfq.projectId);
  const { scope } = splitRfqNotes(rfq.notes);
  if (rfq.boqId) {
    const groups = await boqGroups(rfq.boqId);
    return groups
      .filter((g) => !scope || scope.includes(g.code))
      .map((g) => ({
        deviceTypeId: g.deviceTypeId, code: g.code, name: g.name, quantity: g.quantity,
        departments: [...new Set(g.lines.map((l) => l.department).filter((d): d is string => !!d))],
        boqLineIds: g.lines.map((l) => l.id),
        specId: specs.get(g.deviceTypeId)?.id ?? null, specItemCount: specs.get(g.deviceTypeId)?.items.length ?? 0,
      }));
  }
  const types = specs.size
    ? await db.select().from(deviceTypes).where(inArray(deviceTypes.id, [...specs.keys()])).orderBy(asc(deviceTypes.code))
    : [];
  return types
    .filter((t) => !scope || scope.includes(t.code))
    .map((t) => ({
      deviceTypeId: t.id, code: t.code, name: t.name, quantity: null, departments: [], boqLineIds: [],
      specId: specs.get(t.id)?.id ?? null, specItemCount: specs.get(t.id)?.items.length ?? 0,
    }));
}

/* ───────────── Totals ───────────── */

/** Offer value (non-optional lines, after discount) in the offer currency, keyed by offer id. */
export async function offerTotals(offerIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!offerIds.length) return out;
  const lines = await db.select({ offerId: offerLines.offerId, q: offerLines.quantity, p: offerLines.unitPrice, d: offerLines.discountPct, opt: offerLines.isOptional })
    .from(offerLines).where(inArray(offerLines.offerId, offerIds));
  for (const l of lines) if (!l.opt) out.set(l.offerId, round2((out.get(l.offerId) ?? 0) + lineTotal(l.q, l.p, l.d)));
  return out;
}

export type PoTotals = { value: number; ordered: number; received: number };
export async function poTotals(poIds: number[]): Promise<Map<number, PoTotals>> {
  const out = new Map<number, PoTotals>();
  if (!poIds.length) return out;
  const rows = await db.select({
    poId: poLines.poId,
    value: sql<string>`coalesce(sum(${poLines.quantity} * ${poLines.unitPrice}), 0)`,
    ordered: sql<number>`coalesce(sum(${poLines.quantity}), 0)::int`,
    received: sql<number>`coalesce(sum(least(${poLines.receivedQty}, ${poLines.quantity})), 0)::int`,
  }).from(poLines).where(inArray(poLines.poId, poIds)).groupBy(poLines.poId);
  for (const r of rows) out.set(r.poId, { value: num(r.value), ordered: r.ordered, received: r.received });
  return out;
}

/** Value of non-cancelled POs per project, converted to each project's currency. */
export async function projectPoValues(projectRows: { id: number; currency: string }[]) {
  const out = new Map<number, { total: number | null; partial: number; count: number }>();
  if (!projectRows.length) return out;
  const pos = await db.select({ id: purchaseOrders.id, projectId: purchaseOrders.projectId, currency: purchaseOrders.currency })
    .from(purchaseOrders)
    .where(and(inArray(purchaseOrders.projectId, projectRows.map((p) => p.id)), ne(purchaseOrders.status, "CANCELLED")));
  const totals = await poTotals(pos.map((p) => p.id));
  for (const p of projectRows) {
    const mine = pos.filter((po) => po.projectId === p.id);
    const s = await sumInCurrency(mine.map((po) => ({ amount: totals.get(po.id)?.value ?? 0, currency: po.currency })), p.currency);
    out.set(p.id, { total: s.total, partial: s.partial, count: mine.length });
  }
  return out;
}

/* ───────────── Comparison ───────────── */

export type ComparisonData = Awaited<ReturnType<typeof loadComparison>>;

export async function loadComparison(projectId: number, weights: Weights = normalizeWeights(undefined)) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const offerRows = await db.select({
    id: offers.id, reference: offers.reference, status: offers.status, currency: offers.currency, validUntil: offers.validUntil,
    deliveryWeeks: offers.deliveryWeeks, warrantyMonths: offers.warrantyMonths, incoterm: offers.incoterm,
    supplierId: offers.supplierId, supplierName: suppliers.name,
  }).from(offers).innerJoin(suppliers, eq(suppliers.id, offers.supplierId))
    .where(eq(offers.projectId, projectId)).orderBy(asc(offers.id));
  const competing = offerRows.filter((o) => !EXCLUDED_OFFER_STATUSES.includes(o.status));
  const excluded = offerRows.filter((o) => EXCLUDED_OFFER_STATUSES.includes(o.status));

  const lines = competing.length
    ? await db.select().from(offerLines).where(inArray(offerLines.offerId, competing.map((o) => o.id))).orderBy(asc(offerLines.id))
    : [];
  const comp = lines.length
    ? await db.select().from(offerCompliance).where(inArray(offerCompliance.offerLineId, lines.map((l) => l.id)))
    : [];
  const specs = await projectSpecs(projectId);

  const typeIds = new Set<number>([...specs.keys(), ...lines.map((l) => l.deviceTypeId)]);
  const types = typeIds.size
    ? await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name }).from(deviceTypes)
      .where(inArray(deviceTypes.id, [...typeIds])).orderBy(asc(deviceTypes.code))
    : [];

  // Required quantities from the latest RFQ of the project (if any).
  const [latestRfq] = await db.select().from(rfqs)
    .where(and(eq(rfqs.projectId, projectId), notInArray(rfqs.status, ["CANCELLED"]))).orderBy(desc(rfqs.id)).limit(1);
  const required = new Map<number, number>();
  if (latestRfq) for (const l of await rfqLines(latestRfq)) if (l.quantity != null) required.set(l.deviceTypeId, l.quantity);

  const fx = await fxFactors(competing.map((o) => o.currency), project.currency);

  const compByLine = new Map<number, ComplianceMap>();
  for (const c of comp) {
    const m = compByLine.get(c.offerLineId) ?? {};
    m[c.specItemId] = c.status as ComplianceStatus;
    compByLine.set(c.offerLineId, m);
  }
  const offerById = new Map(competing.map((o) => [o.id, o]));

  const rows: RowInput[] = types.map((t) => ({
    key: t.id,
    specItems: (specs.get(t.id)?.items ?? []).map((i) => ({ id: i.id, mandatory: i.mandatory, weight: i.weight })),
    candidates: lines.filter((l) => l.deviceTypeId === t.id).map((l) => ({
      offerId: l.offerId, lineId: l.id, currency: offerById.get(l.offerId)!.currency, unitPrice: num(l.unitPrice),
      discountPct: l.discountPct, quantity: l.quantity, isOptional: l.isOptional, compliance: compByLine.get(l.id) ?? {},
    })),
  }));

  const evaluation = evaluateProject(rows, fx, weights, competing.map((o) => o.id));
  return {
    project, weights, offers: competing, excluded, lines, types, specs, required, fx, evaluation,
    lineById: new Map(lines.map((l) => [l.id, l])),
  };
}

/** Persist technical / financial scores (default 70/30 weights) on each competing offer of a project. */
export async function recomputeOfferScores(projectId: number) {
  const data = await loadComparison(projectId);
  if (!data) return;
  for (const o of data.offers) {
    const s = data.evaluation.offers.get(o.id);
    await db.update(offers).set({
      technicalScore: s?.technicalScore ?? null,
      financialScore: s?.financialScore ?? null,
    }).where(eq(offers.id, o.id));
  }
}

/** Facility departments for destination pickers. */
export async function facilityDepartments(facilityId: number | null) {
  if (!facilityId) return [];
  return db.select({ id: departments.id, code: departments.code, name: departments.name, nameAr: departments.nameAr })
    .from(departments).where(eq(departments.facilityId, facilityId)).orderBy(asc(departments.name));
}

/** BOQs available for a project (linked to it, or for the same facility and not linked elsewhere). */
export async function projectBoqs(project: { id: number; facilityId: number | null }) {
  return db.select({ id: boqs.id, name: boqs.name, status: boqs.status, version: boqs.version, projectId: boqs.projectId })
    .from(boqs)
    .where(project.facilityId
      ? sql`${boqs.projectId} = ${project.id} or (${boqs.projectId} is null and ${boqs.facilityId} = ${project.facilityId})`
      : eq(boqs.projectId, project.id))
    .orderBy(desc(boqs.id));
}

/** Move a project forward in its workflow (never backwards, never reopens closed/cancelled), logging the change. */
export async function advanceProject(projectId: number | null | undefined, target: import("./labels").ProjectStatus, reason: string) {
  if (!projectId) return;
  const [p] = await db.select({ status: projects.status }).from(projects).where(eq(projects.id, projectId));
  if (!p) return;
  const next = advanceTo(p.status, target);
  if (next === p.status) return;
  await db.update(projects).set({ status: next }).where(eq(projects.id, projectId));
  await logActivity("project", projectId, "status_changed", `Status moved to ${humanizeEnum(next).toLowerCase()}: ${reason}`);
}

/** Data the offer form needs: suppliers, device types (project ones first), BOQ line options and pre-filled lines. */
export async function offerFormData(projectId: number, rfqId: number | null) {
  const [suppliersList, types, specs, rfqRow] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
    deviceTypeOptions(),
    projectSpecs(projectId),
    rfqId ? db.select().from(rfqs).where(and(eq(rfqs.id, rfqId), eq(rfqs.projectId, projectId))).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  const lines = rfqRow ? await rfqLines(rfqRow) : [];
  const relevant = new Set<number>([...specs.keys(), ...lines.map((l) => l.deviceTypeId)]);
  const deviceTypesSorted = [...types.filter((t) => relevant.has(t.id)), ...types.filter((t) => !relevant.has(t.id))]
    .map((t) => ({ id: t.id, code: t.code, name: t.name }));
  const boqLineOptions = rfqRow?.boqId
    ? (await boqGroups(rfqRow.boqId)).flatMap((g) => g.lines.map((l) => ({
      id: l.id, deviceTypeId: g.deviceTypeId, label: `${l.department ?? "BOQ line"} — qty ${l.quantity}`,
    })))
    : [];
  return { suppliers: suppliersList, deviceTypes: deviceTypesSorted, boqLines: boqLineOptions, rfq: rfqRow, rfqLines: lines, specs };
}

/* ───────────── Evaluation locks ───────────── */

/** Purchase orders raised from an offer that are still live (not cancelled). */
export async function livePoNumbers(offerId: number): Promise<string[]> {
  const rows = await db.select({ number: purchaseOrders.number }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.offerId, offerId), ne(purchaseOrders.status, "CANCELLED")));
  return rows.map((r) => r.number);
}

/** Why an offer's evaluation can't be changed right now, or null. Offers under award approval, awarded offers and offers with a PO are locked. */
export async function evaluationLock(offer: { id: number; status: string }): Promise<string | null> {
  const [pending] = await db.select({ id: approvalRequests.id }).from(approvalRequests)
    .where(and(eq(approvalRequests.entity, "AWARD"), eq(approvalRequests.entityId, offer.id), eq(approvalRequests.status, "PENDING"))).limit(1);
  if (pending) return "An award recommendation for this offer is waiting for approval, so its prices and evaluation are locked. Withdraw the recommendation first if the offer must change.";
  const pos = await livePoNumbers(offer.id);
  if (pos.length) return `${pos.join(", ")} was raised from this offer, so its prices and evaluation are locked. Cancel the purchase order first if the offer really must change.`;
  if (offer.status === "AWARDED") return "This offer is awarded, so its prices and evaluation are locked. Revoke the award first to change it.";
  return null;
}

/** Mandatory spec items this offer answered NOT_COMPLIANT. */
export async function mandatoryFailures(offerId: number): Promise<string[]> {
  const rows = await db.select({ parameter: specItems.parameter, device: offerLines.description }).from(offerCompliance)
    .innerJoin(offerLines, eq(offerLines.id, offerCompliance.offerLineId))
    .innerJoin(specItems, eq(specItems.id, offerCompliance.specItemId))
    .where(and(eq(offerLines.offerId, offerId), eq(specItems.mandatory, true), eq(offerCompliance.status, "NOT_COMPLIANT")));
  return rows.map((r) => `${r.parameter} (${r.device})`);
}

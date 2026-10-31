/**
 * Tender evaluation maths. Pure functions — no database, no currency lookups (the caller passes FX factors).
 *
 * Technical score (per offer line, 0–100)
 *   weighted share of the spec items the offer complies with: COMPLIES = 1, PARTIAL = 0.5, NOT_COMPLIANT / NOT_STATED = 0.
 *   Weights ≤ 0 are ignored; if every weight is ≤ 0 all items count equally.
 *   Any mandatory item NOT_COMPLIANT → the line is technically non-responsive (excluded from price ranking and award).
 *   No spec items → score is null ("not evaluated") and the line stays responsive.
 *
 * Financial score (per device type row, 0–100)
 *   lowest responsive net unit price in the project currency ÷ this price × 100.
 *   Lines without an exchange rate, without a positive price, or non-responsive get null.
 *
 * Combined score = technical × wT + financial × wF (weights in %, summing to 100).
 *   Without a technical score the financial score is used on its own; without a financial score there is no combined score.
 *
 * Best value per row = highest combined score; ties go to the lower price; if still tied every tied offer is marked best.
 */

export type ComplianceStatus = "COMPLIES" | "PARTIAL" | "NOT_COMPLIANT" | "NOT_STATED";
export const COMPLIANCE_STATUSES: ComplianceStatus[] = ["COMPLIES", "PARTIAL", "NOT_COMPLIANT", "NOT_STATED"];
export const COMPLIANCE_CREDIT: Record<ComplianceStatus, number> = {
  COMPLIES: 1, PARTIAL: 0.5, NOT_COMPLIANT: 0, NOT_STATED: 0,
};

export type SpecItemForScoring = { id: number; mandatory: boolean; weight: number };
export type ComplianceMap = Partial<Record<number, ComplianceStatus>>;

export type TechnicalResult = {
  /** 0–100, null when the device type has no spec items. */
  score: number | null;
  responsive: boolean;
  itemCount: number;
  counts: Record<ComplianceStatus, number>;
  /** Spec item ids of mandatory items marked NOT_COMPLIANT. */
  mandatoryFailed: number[];
  /** Spec item ids of mandatory items with no answer yet (a clarification is needed, but not disqualifying). */
  mandatoryUnstated: number[];
};

const EPS = 1e-6;

export function technicalEvaluation(items: SpecItemForScoring[], compliance: ComplianceMap): TechnicalResult {
  const counts: Record<ComplianceStatus, number> = { COMPLIES: 0, PARTIAL: 0, NOT_COMPLIANT: 0, NOT_STATED: 0 };
  const mandatoryFailed: number[] = [];
  const mandatoryUnstated: number[] = [];
  if (items.length === 0) {
    return { score: null, responsive: true, itemCount: 0, counts, mandatoryFailed, mandatoryUnstated };
  }
  const weights = items.map((i) => (Number.isFinite(i.weight) && i.weight > 0 ? i.weight : 0));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const equal = totalWeight <= 0;
  let earned = 0;
  items.forEach((item, idx) => {
    const status = compliance[item.id] ?? "NOT_STATED";
    counts[status] += 1;
    earned += (equal ? 1 : weights[idx]) * COMPLIANCE_CREDIT[status];
    if (item.mandatory && status === "NOT_COMPLIANT") mandatoryFailed.push(item.id);
    if (item.mandatory && status === "NOT_STATED") mandatoryUnstated.push(item.id);
  });
  const score = (earned / (equal ? items.length : totalWeight)) * 100;
  return { score, responsive: mandatoryFailed.length === 0, itemCount: items.length, counts, mandatoryFailed, mandatoryUnstated };
}

/** Unit price after discount. */
export function netUnitPrice(unitPrice: number, discountPct: number): number {
  const d = Number.isFinite(discountPct) ? Math.min(Math.max(discountPct, 0), 100) : 0;
  return unitPrice * (1 - d / 100);
}

/**
 * Financial scores for competing prices. Only responsive entries with a positive price take part;
 * everyone else gets null.
 */
export function financialScores<K>(entries: { key: K; price: number | null; responsive: boolean }[]): Map<K, number | null> {
  const eligible = entries.filter((e) => e.responsive && e.price != null && Number.isFinite(e.price) && e.price > 0);
  const lowest = eligible.length ? Math.min(...eligible.map((e) => e.price as number)) : null;
  const out = new Map<K, number | null>();
  for (const e of entries) {
    const ok = lowest != null && eligible.includes(e);
    out.set(e.key, ok ? (lowest! / (e.price as number)) * 100 : null);
  }
  return out;
}

export type Weights = { technical: number; financial: number };
export const DEFAULT_TECHNICAL_WEIGHT = 70;

/** Technical weight in % from a query param (0–100, default 70); financial is the remainder. */
export function normalizeWeights(technicalPct: unknown): Weights {
  const raw = typeof technicalPct === "string" && technicalPct.trim() === "" ? NaN : Number(technicalPct);
  const t = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : DEFAULT_TECHNICAL_WEIGHT;
  return { technical: t, financial: 100 - t };
}

export function combinedScore(technical: number | null, financial: number | null, w: Weights): number | null {
  if (financial == null) return null;
  if (technical == null) return financial;
  const total = w.technical + w.financial;
  if (total <= 0) return null;
  return (technical * w.technical + financial * w.financial) / total;
}

/** Multiply an amount in `currency` by this factor to get the project currency. null/undefined = no rate. */
export type FxFactors = Record<string, number | null | undefined>;

export function toProjectCurrency(amount: number, currency: string, fx: FxFactors): number | null {
  const f = fx[currency];
  return f == null || !Number.isFinite(f) ? null : amount * f;
}

export type OfferLineCandidate = {
  offerId: number;
  lineId: number;
  currency: string;
  unitPrice: number;
  discountPct: number;
  quantity: number;
  isOptional: boolean;
  compliance: ComplianceMap;
};

export type RowInput = { key: number; specItems: SpecItemForScoring[]; candidates: OfferLineCandidate[] };

export type CellResult = {
  offerId: number;
  lineId: number;
  /** Other lines the same offer quoted for this row (alternatives / optional extras). */
  alternatives: number;
  isOptional: boolean;
  quantity: number;
  currency: string;
  /** Net unit price in the offer currency. */
  netUnitPrice: number;
  /** Net unit price in the project currency (null = no exchange rate). */
  unitPrice: number | null;
  lineTotal: number | null;
  missingRate: boolean;
  technical: TechnicalResult;
  financialScore: number | null;
  combinedScore: number | null;
  isBest: boolean;
};

export type RowResult = {
  key: number;
  cells: CellResult[];
  bestOfferIds: number[];
  lowestResponsivePrice: number | null;
  responsiveCount: number;
};

/** Pick the line that represents an offer in a row: a non-optional line first, then the cheapest. */
function pickLine(lines: OfferLineCandidate[]): OfferLineCandidate {
  return [...lines].sort((a, b) => {
    if (a.isOptional !== b.isOptional) return a.isOptional ? 1 : -1;
    const pa = netUnitPrice(a.unitPrice, a.discountPct);
    const pb = netUnitPrice(b.unitPrice, b.discountPct);
    return pa - pb || a.lineId - b.lineId;
  })[0];
}

export function evaluateRow(row: RowInput, fx: FxFactors, weights: Weights): RowResult {
  const byOffer = new Map<number, OfferLineCandidate[]>();
  for (const c of row.candidates) byOffer.set(c.offerId, [...(byOffer.get(c.offerId) ?? []), c]);

  const cells: CellResult[] = [...byOffer.entries()].map(([offerId, lines]) => {
    const line = pickLine(lines);
    const net = netUnitPrice(line.unitPrice, line.discountPct);
    const unitPrice = toProjectCurrency(net, line.currency, fx);
    return {
      offerId,
      lineId: line.lineId,
      alternatives: lines.length - 1,
      isOptional: line.isOptional,
      quantity: line.quantity,
      currency: line.currency,
      netUnitPrice: net,
      unitPrice,
      lineTotal: unitPrice == null ? null : unitPrice * line.quantity,
      missingRate: unitPrice == null,
      technical: technicalEvaluation(row.specItems, line.compliance),
      financialScore: null,
      combinedScore: null,
      isBest: false,
    };
  });

  const fin = financialScores(cells.map((c) => ({ key: c.offerId, price: c.unitPrice, responsive: c.technical.responsive })));
  for (const c of cells) {
    c.financialScore = fin.get(c.offerId) ?? null;
    c.combinedScore = c.technical.responsive ? combinedScore(c.technical.score, c.financialScore, weights) : null;
  }

  const scored = cells.filter((c) => c.combinedScore != null);
  let bestOfferIds: number[] = [];
  if (scored.length) {
    const top = Math.max(...scored.map((c) => c.combinedScore as number));
    let tied = scored.filter((c) => Math.abs((c.combinedScore as number) - top) < EPS);
    if (tied.length > 1) {
      const cheapest = Math.min(...tied.map((c) => c.unitPrice as number));
      tied = tied.filter((c) => Math.abs((c.unitPrice as number) - cheapest) < EPS);
    }
    bestOfferIds = tied.map((c) => c.offerId);
    for (const c of cells) c.isBest = bestOfferIds.includes(c.offerId);
  }

  const responsivePrices = cells.filter((c) => c.technical.responsive && c.unitPrice != null && c.unitPrice > 0).map((c) => c.unitPrice as number);
  return {
    key: row.key,
    cells,
    bestOfferIds,
    lowestResponsivePrice: responsivePrices.length ? Math.min(...responsivePrices) : null,
    responsiveCount: cells.filter((c) => c.technical.responsive).length,
  };
}

export type OfferSummary = {
  offerId: number;
  rowsQuoted: number;
  responsiveRows: number;
  nonResponsiveRows: number;
  /** Sum of the chosen non-optional lines in the project currency; null when any of them lacks an exchange rate. */
  total: number | null;
  missingRate: boolean;
  technicalScore: number | null;
  financialScore: number | null;
  combinedScore: number | null;
  bestRows: number;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export type ProjectEvaluation = { rows: RowResult[]; offers: Map<number, OfferSummary> };

/**
 * Evaluate every row and summarise each offer (plain means of its row scores).
 * In the offer's combined score, lines that fail a mandatory item count as 0.
 */
export function evaluateProject(rows: RowInput[], fx: FxFactors, weights: Weights, offerIds: number[] = []): ProjectEvaluation {
  const results = rows.map((r) => evaluateRow(r, fx, weights));
  const ids = new Set<number>(offerIds);
  for (const r of results) for (const c of r.cells) ids.add(c.offerId);

  const offers = new Map<number, OfferSummary>();
  for (const offerId of ids) {
    const cells = results.flatMap((r) => r.cells.filter((c) => c.offerId === offerId));
    const priced = cells.filter((c) => !c.isOptional);
    const missingRate = cells.some((c) => c.missingRate);
    offers.set(offerId, {
      offerId,
      rowsQuoted: cells.length,
      responsiveRows: cells.filter((c) => c.technical.responsive).length,
      nonResponsiveRows: cells.filter((c) => !c.technical.responsive).length,
      total: priced.some((c) => c.lineTotal == null) ? null : priced.reduce((s, c) => s + (c.lineTotal as number), 0),
      missingRate,
      technicalScore: mean(cells.map((c) => c.technical.score).filter((x): x is number => x != null)),
      financialScore: mean(cells.map((c) => c.financialScore).filter((x): x is number => x != null)),
      // A non-responsive line counts as 0, so an offer can't outrank a compliant one by dropping its failing lines.
      combinedScore: mean(cells.flatMap((c) => (!c.technical.responsive ? [0] : c.combinedScore != null ? [c.combinedScore] : []))),
      bestRows: results.filter((r) => r.bestOfferIds.includes(offerId)).length,
    });
  }
  return { rows: results, offers };
}

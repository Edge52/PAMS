import { describe, expect, it } from "vitest";
import {
  combinedScore, evaluateProject, evaluateRow, financialScores, netUnitPrice, normalizeWeights,
  technicalEvaluation, toProjectCurrency, type OfferLineCandidate, type SpecItemForScoring,
} from "./scoring";

const items: SpecItemForScoring[] = [
  { id: 1, mandatory: true, weight: 2 },
  { id: 2, mandatory: false, weight: 1 },
  { id: 3, mandatory: false, weight: 1 },
];
const W = normalizeWeights(undefined);

function cand(p: Partial<OfferLineCandidate> & { offerId: number }): OfferLineCandidate {
  return {
    lineId: p.offerId * 10, currency: "USD", unitPrice: 100, discountPct: 0, quantity: 1, isOptional: false,
    compliance: { 1: "COMPLIES", 2: "COMPLIES", 3: "COMPLIES" }, ...p,
  };
}

describe("technicalEvaluation", () => {
  it("scores weighted share of complying items, partial counts half", () => {
    const r = technicalEvaluation(items, { 1: "COMPLIES", 2: "PARTIAL", 3: "NOT_STATED" });
    expect(r.score).toBeCloseTo((2 + 0.5) / 4 * 100);
    expect(r.responsive).toBe(true);
    expect(r.counts).toEqual({ COMPLIES: 1, PARTIAL: 1, NOT_COMPLIANT: 0, NOT_STATED: 1 });
  });

  it("treats a failed mandatory item as non-responsive", () => {
    const r = technicalEvaluation(items, { 1: "NOT_COMPLIANT", 2: "COMPLIES", 3: "COMPLIES" });
    expect(r.responsive).toBe(false);
    expect(r.mandatoryFailed).toEqual([1]);
    expect(r.score).toBeCloseTo(50);
  });

  it("does not disqualify for a failed optional item", () => {
    const r = technicalEvaluation(items, { 1: "COMPLIES", 2: "NOT_COMPLIANT", 3: "COMPLIES" });
    expect(r.responsive).toBe(true);
    expect(r.score).toBeCloseTo(75);
  });

  it("flags unanswered mandatory items without disqualifying", () => {
    const r = technicalEvaluation(items, {});
    expect(r.responsive).toBe(true);
    expect(r.score).toBe(0);
    expect(r.mandatoryUnstated).toEqual([1]);
  });

  it("returns null score and stays responsive when there are no spec items", () => {
    const r = technicalEvaluation([], {});
    expect(r.score).toBeNull();
    expect(r.responsive).toBe(true);
    expect(r.itemCount).toBe(0);
  });

  it("falls back to equal weights when all weights are zero or negative", () => {
    const r = technicalEvaluation(
      [{ id: 1, mandatory: false, weight: 0 }, { id: 2, mandatory: false, weight: -1 }],
      { 1: "COMPLIES", 2: "NOT_COMPLIANT" },
    );
    expect(r.score).toBeCloseTo(50);
  });

  it("ignores zero-weight items in the score but still checks them when mandatory", () => {
    const r = technicalEvaluation(
      [{ id: 1, mandatory: true, weight: 0 }, { id: 2, mandatory: false, weight: 1 }],
      { 1: "NOT_COMPLIANT", 2: "COMPLIES" },
    );
    expect(r.score).toBeCloseTo(100);
    expect(r.responsive).toBe(false);
  });
});

describe("prices and weights", () => {
  it("applies and clamps discounts", () => {
    expect(netUnitPrice(1000, 10)).toBe(900);
    expect(netUnitPrice(1000, -5)).toBe(1000);
    expect(netUnitPrice(1000, 150)).toBe(0);
    expect(netUnitPrice(1000, Number.NaN)).toBe(1000);
  });

  it("converts with a factor and returns null when the rate is missing", () => {
    expect(toProjectCurrency(100, "EUR", { EUR: 1.1 })).toBeCloseTo(110);
    expect(toProjectCurrency(100, "CNY", { EUR: 1.1 })).toBeNull();
    expect(toProjectCurrency(100, "CNY", { CNY: null })).toBeNull();
  });

  it("normalises the technical weight from a query param", () => {
    expect(normalizeWeights(undefined)).toEqual({ technical: 70, financial: 30 });
    expect(normalizeWeights("")).toEqual({ technical: 70, financial: 30 });
    expect(normalizeWeights("abc")).toEqual({ technical: 70, financial: 30 });
    expect(normalizeWeights("55.4")).toEqual({ technical: 55, financial: 45 });
    expect(normalizeWeights("140")).toEqual({ technical: 100, financial: 0 });
    expect(normalizeWeights("-3")).toEqual({ technical: 0, financial: 100 });
  });

  it("combines scores, using financial alone when there is no technical score", () => {
    expect(combinedScore(80, 100, { technical: 70, financial: 30 })).toBeCloseTo(86);
    expect(combinedScore(null, 90, W)).toBe(90);
    expect(combinedScore(80, null, W)).toBeNull();
  });
});

describe("financialScores", () => {
  it("gives 100 to the lowest responsive price and scales the rest", () => {
    const m = financialScores([
      { key: "a", price: 100, responsive: true },
      { key: "b", price: 125, responsive: true },
      { key: "c", price: 50, responsive: false },
      { key: "d", price: null, responsive: true },
      { key: "e", price: 0, responsive: true },
    ]);
    expect(m.get("a")).toBe(100);
    expect(m.get("b")).toBe(80);
    expect(m.get("c")).toBeNull();
    expect(m.get("d")).toBeNull();
    expect(m.get("e")).toBeNull();
  });

  it("returns all nulls when every entry is non-responsive", () => {
    const m = financialScores([{ key: 1, price: 10, responsive: false }, { key: 2, price: 20, responsive: false }]);
    expect([...m.values()]).toEqual([null, null]);
  });
});

describe("evaluateRow", () => {
  const fx = { USD: 1, EUR: 1.1 };

  it("excludes the cheapest non-compliant offer and picks best value among the rest", () => {
    const r = evaluateRow({
      key: 1, specItems: items, candidates: [
        cand({ offerId: 1, unitPrice: 80, compliance: { 1: "NOT_COMPLIANT", 2: "COMPLIES", 3: "COMPLIES" } }),
        cand({ offerId: 2, unitPrice: 100 }),
        cand({ offerId: 3, unitPrice: 90, compliance: { 1: "COMPLIES", 2: "PARTIAL", 3: "NOT_STATED" } }),
      ],
    }, fx, W);
    const c1 = r.cells.find((c) => c.offerId === 1)!;
    const c2 = r.cells.find((c) => c.offerId === 2)!;
    const c3 = r.cells.find((c) => c.offerId === 3)!;
    expect(c1.technical.responsive).toBe(false);
    expect(c1.financialScore).toBeNull();
    expect(c1.combinedScore).toBeNull();
    expect(c3.financialScore).toBe(100);
    expect(c2.financialScore).toBeCloseTo(90);
    // c2: 0.7*100 + 0.3*90 = 97 ; c3: 0.7*62.5 + 0.3*100 = 73.75
    expect(c2.combinedScore).toBeCloseTo(97);
    expect(c3.combinedScore).toBeCloseTo(73.75);
    expect(r.bestOfferIds).toEqual([2]);
    expect(r.lowestResponsivePrice).toBe(90);
    expect(r.responsiveCount).toBe(2);
  });

  it("weights move the winner: 0% technical makes it a pure price contest", () => {
    const r = evaluateRow({
      key: 1, specItems: items, candidates: [
        cand({ offerId: 2, unitPrice: 100 }),
        cand({ offerId: 3, unitPrice: 90, compliance: { 1: "COMPLIES", 2: "PARTIAL", 3: "NOT_STATED" } }),
      ],
    }, fx, normalizeWeights("0"));
    expect(r.bestOfferIds).toEqual([3]);
  });

  it("converts currencies before comparing and applies discounts", () => {
    const r = evaluateRow({
      key: 1, specItems: [], candidates: [
        cand({ offerId: 1, currency: "EUR", unitPrice: 100 }),                // 110 USD
        cand({ offerId: 2, currency: "USD", unitPrice: 120, discountPct: 10 }), // 108 USD
      ],
    }, fx, W);
    expect(r.cells.find((c) => c.offerId === 1)!.unitPrice).toBeCloseTo(110);
    expect(r.cells.find((c) => c.offerId === 2)!.unitPrice).toBeCloseTo(108);
    expect(r.bestOfferIds).toEqual([2]);
  });

  it("handles a missing currency rate: no price, no scores, flagged", () => {
    const r = evaluateRow({
      key: 1, specItems: items, candidates: [cand({ offerId: 1, currency: "CNY", unitPrice: 700 }), cand({ offerId: 2, unitPrice: 100 })],
    }, fx, W);
    const c1 = r.cells.find((c) => c.offerId === 1)!;
    expect(c1.missingRate).toBe(true);
    expect(c1.unitPrice).toBeNull();
    expect(c1.lineTotal).toBeNull();
    expect(c1.financialScore).toBeNull();
    expect(c1.combinedScore).toBeNull();
    expect(r.bestOfferIds).toEqual([2]);
  });

  it("has no best offer when every offer is non-compliant", () => {
    const fail = { 1: "NOT_COMPLIANT", 2: "COMPLIES", 3: "COMPLIES" } as const;
    const r = evaluateRow({
      key: 1, specItems: items, candidates: [cand({ offerId: 1, compliance: fail }), cand({ offerId: 2, unitPrice: 50, compliance: fail })],
    }, fx, W);
    expect(r.bestOfferIds).toEqual([]);
    expect(r.lowestResponsivePrice).toBeNull();
    expect(r.cells.every((c) => !c.isBest)).toBe(true);
  });

  it("breaks score ties by price, and marks all if price ties too", () => {
    // No spec items → combined = financial only; equal prices → both 100 → tie on price → both best.
    const tie = evaluateRow({ key: 1, specItems: [], candidates: [cand({ offerId: 1 }), cand({ offerId: 2 })] }, fx, W);
    expect(tie.bestOfferIds.sort()).toEqual([1, 2]);

    // A pricier but fully compliant offer beats a cheaper, weaker one at 70/30:
    // A: tech 100, price 125 → fin 80 → 94.  B: tech 6/7 = 85.7, price 100 → fin 100 → 90.
    const a = cand({ offerId: 1, unitPrice: 125 });
    const specs: SpecItemForScoring[] = [{ id: 1, mandatory: false, weight: 6 }, { id: 2, mandatory: false, weight: 1 }];
    const b = cand({ offerId: 2, unitPrice: 100, compliance: { 1: "COMPLIES", 2: "NOT_STATED" } });
    const r = evaluateRow({ key: 1, specItems: specs, candidates: [{ ...a, compliance: { 1: "COMPLIES", 2: "COMPLIES" } }, b] }, fx, { technical: 70, financial: 30 });
    const ca = r.cells.find((c) => c.offerId === 1)!;
    const cb = r.cells.find((c) => c.offerId === 2)!;
    expect(ca.combinedScore).toBeCloseTo(94);
    expect(cb.combinedScore).toBeCloseTo(0.7 * (600 / 7) + 30);
    expect(r.bestOfferIds).toEqual([1]);
  });

  it("breaks an exact combined-score tie in favour of the lower price", () => {
    // weights 50/50. A: tech 100, price 125 → fin 80 → 90. B: tech 80, price 100 → fin 100 → 90.
    const specs: SpecItemForScoring[] = [
      { id: 1, mandatory: false, weight: 4 }, { id: 2, mandatory: false, weight: 1 },
    ];
    const r = evaluateRow({
      key: 1, specItems: specs, candidates: [
        cand({ offerId: 1, unitPrice: 125, compliance: { 1: "COMPLIES", 2: "COMPLIES" } }),
        cand({ offerId: 2, unitPrice: 100, compliance: { 1: "COMPLIES", 2: "NOT_COMPLIANT" } }),
      ],
    }, fx, normalizeWeights("50"));
    expect(r.cells[0].combinedScore).toBeCloseTo(90);
    expect(r.cells[1].combinedScore).toBeCloseTo(90);
    expect(r.bestOfferIds).toEqual([2]);
  });

  it("represents an offer by its non-optional line and counts alternatives", () => {
    const r = evaluateRow({
      key: 1, specItems: [], candidates: [
        cand({ offerId: 1, lineId: 11, unitPrice: 50, isOptional: true }),
        cand({ offerId: 1, lineId: 12, unitPrice: 100 }),
      ],
    }, fx, W);
    expect(r.cells).toHaveLength(1);
    expect(r.cells[0].lineId).toBe(12);
    expect(r.cells[0].alternatives).toBe(1);
  });
});

describe("evaluateProject", () => {
  it("summarises totals and scores per offer, including offers with no lines", () => {
    const rows = [
      { key: 1, specItems: items, candidates: [cand({ offerId: 1, unitPrice: 100, quantity: 2 }), cand({ offerId: 2, unitPrice: 80, quantity: 2 })] },
      { key: 2, specItems: [], candidates: [cand({ offerId: 1, unitPrice: 10, quantity: 5 }), cand({ offerId: 2, currency: "CNY", unitPrice: 70, quantity: 5 })] },
    ];
    const ev = evaluateProject(rows, { USD: 1 }, W, [1, 2, 3]);
    const o1 = ev.offers.get(1)!;
    const o2 = ev.offers.get(2)!;
    const o3 = ev.offers.get(3)!;
    expect(o1.total).toBe(250);
    expect(o1.rowsQuoted).toBe(2);
    expect(o2.total).toBeNull();
    expect(o2.missingRate).toBe(true);
    expect(o3.rowsQuoted).toBe(0);
    expect(o3.total).toBe(0);
    expect(o3.combinedScore).toBeNull();
    expect(o2.bestRows).toBe(1); // cheaper on row 1, no rate on row 2
    expect(o1.bestRows).toBe(1);
  });

  it("excludes optional lines from the offer total", () => {
    const ev = evaluateProject([
      { key: 1, specItems: [], candidates: [cand({ offerId: 1, unitPrice: 100 })] },
      { key: 2, specItems: [], candidates: [cand({ offerId: 1, unitPrice: 40, isOptional: true })] },
    ], { USD: 1 }, W);
    expect(ev.offers.get(1)!.total).toBe(100);
  });
});

describe("offer combined score with a non-responsive line (regression)", () => {
  it("counts the failing line as 0 so the offer can't outrank a fully compliant one", () => {
    const fails = { 1: "NOT_COMPLIANT", 2: "COMPLIES", 3: "COMPLIES" } as const;
    const ev = evaluateProject([
      { key: 1, specItems: items, candidates: [cand({ offerId: 1, unitPrice: 100 }), cand({ offerId: 2, unitPrice: 100 })] },
      { key: 2, specItems: items, candidates: [cand({ offerId: 1, unitPrice: 90, compliance: fails }), cand({ offerId: 2, unitPrice: 120 })] },
    ], { USD: 1 }, W);
    const o1 = ev.offers.get(1)!, o2 = ev.offers.get(2)!;
    expect(o1.nonResponsiveRows).toBe(1);
    expect(o1.combinedScore).toBeCloseTo(50);           // (100 + 0) / 2
    expect(o2.combinedScore!).toBeGreaterThan(o1.combinedScore!);
  });
});

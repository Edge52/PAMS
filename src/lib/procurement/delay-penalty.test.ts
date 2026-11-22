import { describe, expect, it } from "vitest";
import { deductionProblem, delayPenalty, penaltyLeft, penaltyNote, penaltyTerms, weeksLate } from "./delay-penalty";

const terms = { ratePctPerWeek: 1, capPct: 15 };
const line = { id: 1, description: "Monitor", quantity: 10, unitPrice: 1000 };

describe("weeksLate", () => {
  it("counts a started week as a week", () => {
    expect(weeksLate("2026-10-01", "2026-10-01")).toEqual({ days: 0, weeks: 0 });
    expect(weeksLate("2026-10-01", "2026-09-20")).toEqual({ days: 0, weeks: 0 });
    expect(weeksLate("2026-10-01", "2026-10-02")).toEqual({ days: 1, weeks: 1 });
    expect(weeksLate("2026-10-01", "2026-10-08")).toEqual({ days: 7, weeks: 1 });
    expect(weeksLate("2026-10-01", "2026-10-09")).toEqual({ days: 8, weeks: 2 });
  });
});

describe("delayPenalty", () => {
  it("is nothing without an expected date or when on time", () => {
    expect(delayPenalty({ expectedDelivery: null, lines: [line], deliveries: [], terms, asOf: "2026-12-01" }).amount).toBe(0);
    const r = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: [{ date: "2026-10-01", lines: [{ poLineId: 1, quantity: 10 }] }], terms, asOf: "2026-12-01" });
    expect(r.amount).toBe(0);
    expect(r.parts).toEqual([]);
  });

  it("charges only the late units of a partial delivery", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", lines: [line], terms, asOf: "2026-12-01",
      deliveries: [{ date: "2026-09-30", lines: [{ poLineId: 1, quantity: 6 }] }, { date: "2026-10-16", lines: [{ poLineId: 1, quantity: 4 }] }],
    });
    // 4 units × 1000 × 3 weeks (15 days) × 1 %
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ units: 4, weeks: 3, pct: 3, amount: 120 });
    expect(r.lateValue).toBe(4000);
    expect(r.provisional).toBe(false);
  });

  it("caps each part at the maximum", () => {
    const r = delayPenalty({ expectedDelivery: "2026-01-01", lines: [line], deliveries: [{ date: "2026-07-01", lines: [{ poLineId: 1, quantity: 10 }] }], terms, asOf: "2026-12-01" });
    expect(r.parts[0].weeks).toBe(26);
    expect(r.parts[0].pct).toBe(15);
    expect(r.parts[0].capped).toBe(true);
    expect(r.amount).toBe(1500);
  });

  it("counts outstanding units up to asOf on an open order, and not on a closed one", () => {
    const base = { expectedDelivery: "2026-11-01", lines: [line], terms, asOf: "2026-11-10", deliveries: [{ date: "2026-10-30", lines: [{ poLineId: 1, quantity: 5 }] }] };
    const open = delayPenalty(base);
    expect(open.provisional).toBe(true);
    expect(open.parts[0]).toMatchObject({ units: 5, deliveredOn: null, daysLate: 9, weeks: 2, amount: 100 });
    expect(delayPenalty({ ...base, countOutstanding: false }).amount).toBe(0);
  });

  it("ignores deliveries beyond the ordered quantity and handles several lines", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", terms: { ratePctPerWeek: 0.5, capPct: 10 }, asOf: "2026-10-05",
      lines: [{ id: 1, description: "A", quantity: 2, unitPrice: 100 }, { id: 2, description: "B", quantity: 1, unitPrice: 50 }],
      deliveries: [{ date: "2026-10-03", lines: [{ poLineId: 1, quantity: 5 }, { poLineId: 2, quantity: 1 }] }],
    });
    expect(r.parts.map((p) => [p.poLineId, p.units, p.amount])).toEqual([[1, 2, 1], [2, 1, 0.25]]);
    expect(r.amount).toBe(1.25);
  });

  it("writes a note that shows the calculation", () => {
    const r = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: [{ date: "2026-10-10", lines: [{ poLineId: 1, quantity: 10 }] }], terms, asOf: "2026-12-01" });
    const note = penaltyNote(r, (n) => n.toFixed(2));
    expect(note).toContain("10 × Monitor: delivered 2026-10-10, 9 days late = 2 weeks × 1 % = 2 % of 10000.00 = 200.00");
    expect(note).toContain("Total 200.00.");
  });
});

describe("terms and deductions", () => {
  it("uses the order's own terms, else the defaults", () => {
    expect(penaltyTerms({}, terms)).toEqual(terms);
    expect(penaltyTerms({ delayPenaltyRatePct: 0.5, delayPenaltyCapPct: null }, terms)).toEqual({ ratePctPerWeek: 0.5, capPct: 15 });
    expect(penaltyTerms({ delayPenaltyRatePct: -1, delayPenaltyCapPct: 200 }, terms)).toEqual(terms);
  });
  it("never deducts twice across invoices", () => {
    expect(penaltyLeft(300, 120)).toBe(180);
    expect(penaltyLeft(300, 400)).toBe(0);
    expect(deductionProblem(100, 5000, 180)).toBeNull();
    expect(deductionProblem(200, 5000, 180)).toMatch(/left to deduct/);
    expect(deductionProblem(200, 150, 300)).toMatch(/more than the invoice total/);
    expect(deductionProblem(-1, 150, 300)).toMatch(/Enter the penalty/);
  });
});

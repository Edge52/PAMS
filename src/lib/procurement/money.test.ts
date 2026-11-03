import { describe, expect, it } from "vitest";
import { budgetCrossing, budgetUse, checkCallOff, matchInvoice, requiredBond, scorecard, warrantyEndFrom } from "./money";

const line = { poLineId: 1, description: "Monitor", ordered: 10, received: 6, poUnitPrice: 100, invoicedBefore: 0, quantity: 6, unitPrice: 100 };
describe("three-way match", () => {
  it("matches what was received at the PO price", () => {
    const r = matchInvoice([line]);
    expect(r.ok).toBe(true); expect(r.total).toBe(600); expect(r.difference).toBe(0);
  });
  it("flags more than received, more than ordered, and a higher price", () => {
    expect(matchInvoice([{ ...line, quantity: 7 }]).lines[0].problems[0]).toMatch(/only 6 received/);
    expect(matchInvoice([{ ...line, invoicedBefore: 6, quantity: 5, received: 10 }]).lines[0].problems[0]).toMatch(/11 of 10 ordered/);
    const p = matchInvoice([{ ...line, unitPrice: 102 }]);
    expect(p.ok).toBe(false); expect(p.difference).toBe(12);
    expect(matchInvoice([{ ...line, unitPrice: 100.9 }]).ok).toBe(true); // within 1 %
  });
});

describe("budgets", () => {
  it("measures use and the crossing a new PO causes", () => {
    expect(budgetUse(1000, 500, 300)).toMatchObject({ used: 800, remaining: 200, level: "WARN" });
    expect(budgetUse(1000, 900, 300).level).toBe("OVER");
    expect(budgetCrossing(1000, 700, 150)).toBe("80");
    expect(budgetCrossing(1000, 850, 200)).toBe("100");
    expect(budgetCrossing(1000, 100, 100)).toBeNull();
  });
});

describe("framework call-off", () => {
  const fw = { startDate: "2026-01-01", endDate: "2026-12-31", ceiling: 10000, calledOff: 8000 };
  it("keeps call-offs within dates, ceiling and item limits", () => {
    expect(checkCallOff(fw, [{ description: "Pump", qty: 2, unitPrice: 500, maxQty: 10, usedQty: 4 }], "2026-06-01").ok).toBe(true);
    const r = checkCallOff(fw, [{ description: "Pump", qty: 7, unitPrice: 500, maxQty: 10, usedQty: 4 }], "2027-01-02");
    expect(r.problems).toHaveLength(3);
  });
});

describe("bonds, scorecards and warranty", () => {
  it("works out bonds", () => { expect(requiredBond("BID", 1_000_000)).toBe(15000); expect(requiredBond("PERFORMANCE", 1_000_000)).toBe(50000); });
  it("scores a supplier", () => {
    const s = scorecard({ deliveries: [{ daysLate: 0 }, { daysLate: 10 }], accepted: 9, acceptanceIssues: 1, warrantyResponseHours: [12, 24, 48], invoices: 4, invoiceExceptions: 1 });
    expect(s.onTimePct).toBe(50); expect(s.acceptancePct).toBe(90); expect(s.warrantyMedianH).toBe(24); expect(s.invoiceMatchPct).toBe(75);
    expect(s.score).toBe(Math.round((50 * 2 + 90 + 100 + 75) / 5)); expect(s.grade).toBe("B");
    expect(scorecard({ deliveries: [], accepted: 0, acceptanceIssues: 0, warrantyResponseHours: [], invoices: 0, invoiceExceptions: 0 }).grade).toBeNull();
  });
  it("starts the warranty at acceptance", () => { expect(warrantyEndFrom("2026-03-31", 24)).toBe("2028-03-31"); expect(warrantyEndFrom("2026-01-01", null)).toBeNull(); });
});

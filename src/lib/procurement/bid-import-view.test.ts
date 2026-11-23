import { describe, expect, it } from "vitest";
import type { BidCheck } from "./bid-import";
import { bidPreview } from "./bid-import-view";

const check: BidCheck = {
  errors: [], warnings: [], notQuoted: [], deliveryWeeks: 8, warrantyMonths: 12,
  header: { reference: "Q-1", offerDate: "2026-11-20", validUntil: null, currency: "USD", incoterm: null, paymentTerms: null },
  lines: [{ deviceTypeId: 1, code: "A", name: "CT", boqLineId: null, quantity: 1, unitPrice: 100, discountPct: 5, manufacturer: "GE", model: "X", countryOfOrigin: null,
    deliveryWeeks: 8, warrantyMonths: 12, remark: null, compliance: [{ specItemId: 9, status: "NOT_COMPLIANT", offeredValue: null, remark: null, pageRef: null }] }],
};
const lines = [{ deviceTypeId: 1, code: "A", name: "CT", quantity: 1, departments: [], boqLineIds: [], specItems: [{ id: 9, section: null, parameter: "Slices", requirement: "64", unit: null, mandatory: true }] }];

describe("bidPreview", () => {
  it("shows prices to people who may see them", () => {
    const p = bidPreview(check, { supplier: "S", lines, showPrices: true, sealed: false, replaces: null });
    expect(p.lines[0]).toMatchObject({ unitPrice: 100, discountPct: 5, answered: 1, specItems: 1, mandatoryNo: 1 });
    expect(p.pricesNote).toBeNull();
  });
  it("hides prices without prices.view or while sealed", () => {
    for (const o of [{ showPrices: false, sealed: false }, { showPrices: true, sealed: true }]) {
      const p = bidPreview(check, { supplier: "S", lines, replaces: null, ...o });
      expect(p.lines[0].unitPrice).toBeNull();
      expect(p.lines[0].discountPct).toBeNull();
      expect(JSON.stringify(p)).not.toContain("100");
      expect(p.pricesNote).toMatch(/not shown/);
    }
  });
});

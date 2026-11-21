import { describe, expect, it } from "vitest";
import { attentionItems, budgetFigures, equipmentFigures } from "./executive-calc";

describe("executive summary", () => {
  it("adds up equipment figures and availability", () => {
    const e = equipmentFigures([[1, "IN_SERVICE", 0, 0, 0, 0, 100, 0], [2, "OUT_OF_SERVICE", 1, 1, 1, 24, 50, 1], [3, "IN_STOCK", 0, 0, 0, 0, 10, 0]]);
    expect(e).toMatchObject({ devices: 3, inService: 1, down: 1, availabilityPct: 50, openJobs: 1, overduePpm: 1, recalls: 1, valueEgp: 160 });
  });
  it("lists the worst first and caps the list", () => {
    const eq = equipmentFigures([[1, "IN_SERVICE", 0, 1, 0, 0, 0, 0]]);
    const a = attentionItems({ facilityId: 2, eq, urgentOpen: 2, lateJobs: 1, contractsEnding: 0, warrantyEnding: 3, unsupportedUnits: 0, latePos: 0, pendingApprovals: 4 }, 4);
    expect(a.map((x) => x.text)).toEqual(["2 urgent faults still open", "1 job past the response target", "1 device overdue for planned maintenance", "4 approvals waiting"]);
  });
});

describe("capital budget tile (DL-06)", () => {
  it("converts each budget line to EGP before adding up", () => {
    // 1,000,000 EGP with 500,000 used, and 100,000 USD (at 50) with 90,000 used. Adding raw numbers gave 54 %.
    const b = budgetFigures([
      { amount: "1000000", used: 500000, currency: "EGP" },
      { amount: "100000", used: 90000, currency: "USD" },
    ], new Map([["USD", 50]]));
    expect(b.totalEgp).toBe(6_000_000);
    expect(b.usedEgp).toBe(5_000_000);
    expect(b.pct).toBe(83);
    expect(b.missing).toEqual([]);
  });

  it("leaves out lines without a rate and lists their currency", () => {
    const b = budgetFigures([
      { amount: "1000", used: 100, currency: "EGP" },
      { amount: "500", used: 400, currency: "EUR", missingRate: true },
    ], new Map([["EUR", null]]));
    expect(b.totalEgp).toBe(1000);
    expect(b.pct).toBe(10);
    expect(b.missing).toEqual(["EUR"]);
    expect(b.poMissingRate).toBe(true);
  });
});

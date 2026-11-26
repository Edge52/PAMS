import { describe, expect, it } from "vitest";
import { FxTable } from "../fx";
import { convertSpend, groupSpend, parseBasis, parseDim, spendTotal, topN, topShare, type SpendRow } from "./spend";

const fx = new FxTable([
  { currency: "USD", rateToEgp: 30, effectiveDate: "2025-01-01" },
  { currency: "USD", rateToEgp: 50, effectiveDate: "2026-01-01" },
  { currency: "EUR", rateToEgp: 55, effectiveDate: "2026-01-01" },
]);
const row = (o: Partial<SpendRow>): SpendRow => ({
  date: "2026-03-01", currency: "EGP", amount: 100, lines: 1, supplierId: 1, supplier: "Alpha",
  categoryId: 10, category: "Imaging", departmentId: 5, department: "Radiology", ...o,
});

describe("spend", () => {
  it("converts each amount at the rate of its own date", () => {
    const { lines, missing } = convertSpend([
      row({ currency: "USD", amount: 10, date: "2025-06-01" }),
      row({ currency: "USD", amount: 10, date: "2026-06-01" }),
      row({ currency: "GBP", amount: 10 }),
      row({ currency: "EGP", amount: 7 }),
    ], fx);
    expect(lines.map((l) => l.egp)).toEqual([300, 500, 7]);
    expect(missing).toEqual(["GBP"]);
    expect(spendTotal(lines)).toBe(807);
  });

  it("groups by supplier, keeps unknowns apart and orders by size", () => {
    const { lines } = convertSpend([
      row({ amount: 100 }), row({ amount: 50, supplierId: 2, supplier: "Beta" }), row({ amount: 300, supplierId: null, supplier: null }), row({ amount: 25 }),
    ], fx);
    const g = groupSpend(lines, "supplier");
    expect(g.map((x) => [x.label, x.egp, x.lines])).toEqual([["No supplier recorded", 300, 1], ["Alpha", 125, 2], ["Beta", 50, 1]]);
    expect(g.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it("groups by year in date order and by currency with the original amount", () => {
    const { lines } = convertSpend([row({ date: "2026-02-01", currency: "USD", amount: 2 }), row({ date: "2025-02-01", currency: "USD", amount: 1 }), row({ amount: 10 })], fx);
    expect(groupSpend(lines, "year").map((g) => g.key)).toEqual(["2025", "2026"]);
    const cur = groupSpend(lines, "currency");
    expect(cur.find((g) => g.key === "USD")).toMatchObject({ egp: 130, original: 3 });
  });

  it("keeps the top N and adds up the rest", () => {
    const { lines } = convertSpend([1, 2, 3, 4, 5].map((i) => row({ amount: i * 10, supplierId: i, supplier: `S${i}` })), fx);
    const g = groupSpend(lines, "supplier");
    const t = topN(g, 2);
    expect(t.map((x) => x.label)).toEqual(["S5", "S4", "Other (3)"]);
    expect(t[2].egp).toBe(60);
    expect(topN(g, 4)).toHaveLength(5); // one left over: shown as itself
    expect(topShare(g, 1)).toBeCloseTo(50 / 150);
    expect(topShare([], 3)).toBeNull();
  });

  it("reads the choices from the address", () => {
    expect(parseBasis("invoice")).toBe("invoice");
    expect(parseBasis("x")).toBe("po");
    expect(parseDim("department")).toBe("department");
    expect(parseDim(undefined)).toBe("supplier");
  });
});

import { describe, expect, it } from "vitest";
import { comparisonFileName, comparisonGrid, comparisonWorkbook, complianceText, type SheetInput } from "./comparison-sheet";
import { evaluateProject, normalizeWeights, type RowInput } from "./scoring";

const W = normalizeWeights(undefined);
const rows: RowInput[] = [
  { key: 1, required: 2, specItems: [{ id: 1, mandatory: true, weight: 1 }], candidates: [
    { offerId: 10, lineId: 100, currency: "USD", unitPrice: 100, discountPct: 0, quantity: 2, isOptional: false, compliance: { 1: "COMPLIES" } },
    { offerId: 20, lineId: 200, currency: "EUR", unitPrice: 80, discountPct: 0, quantity: 2, isOptional: false, compliance: { 1: "NOT_COMPLIANT" } },
  ] },
  { key: 2, required: 1, specItems: [], candidates: [
    { offerId: 10, lineId: 101, currency: "USD", unitPrice: 50, discountPct: 10, quantity: 1, isOptional: false, compliance: {} },
  ] },
];
const ev = evaluateProject(rows, { USD: 1, EUR: 1.1 }, W, [10, 20]);
const input = (sealed: boolean): SheetInput => ({
  title: "T-1 comparison", currency: "USD", priceDate: "2026-09-01", priceBasis: "net price", sealed,
  offers: [{ id: 10, supplierName: "A", reference: "Q1", currency: "USD", incoterm: "DDP" }, { id: 20, supplierName: "B", reference: "Q2", currency: "EUR", incoterm: null }],
  items: [{ key: 1, code: "MON", name: "Monitor", required: 2 }, { key: 2, code: "PMP", name: "Pump", required: 1 }],
  cell: (k, o) => ev.rows.find((r) => r.key === k)?.cells.find((c) => c.offerId === o),
  summary: (o) => ev.offers.get(o), landed: (o) => (o === 10 ? 245 : null), rank: (o) => (o === 10 ? 1 : null), weights: W,
});

describe("comparisonGrid", () => {
  it("lays out price, quantity, total and compliance per offer, then totals", () => {
    const g = comparisonGrid(input(false));
    expect(g.header2.slice(3, 7)).toEqual(["Unit price (USD)", "Quantity", "Total (USD)", "Compliance"]);
    expect(g.header1[3]).toBe("A · Q1 (USD, DDP)");
    expect(g.items[0]).toEqual(["Monitor", "MON", 2, 100, 2, 200, "100 % compliant", 88, 2, 176, "Fails 1 mandatory"]);
    expect(g.items[1].slice(3)).toEqual([45, 1, 45, "No spec", null, null, null, "Not quoted"]);
    const labels = g.totals.map((t) => t.label);
    expect(labels).toEqual(["Net total (USD)", "Landed total, DDP equivalent (USD)", "Technical score", "Financial score", "Combined score (70/30)", "Rank", "Notes"]);
    expect(g.totals[0].values[5]).toBe(245);
    expect(g.totals[1].values[5]).toBe(245);
    expect(g.totals[5].values[5]).toBe(1);
  });

  it("leaves every price out of a sealed tender", () => {
    const g = comparisonGrid(input(true));
    expect(g.perOffer).toEqual(["qty", "compliance"]);
    expect(g.header2.some((h) => /price|Total/i.test(h))).toBe(false);
    expect(g.items[0]).toEqual(["Monitor", "MON", 2, 2, "100 % compliant", 2, "Fails 1 mandatory"]);
    expect(g.totals.map((t) => t.label)).toEqual(["Technical score", "Notes"]);
  });

  it("builds a workbook and a safe file name", async () => {
    const wb = comparisonWorkbook(input(false));
    const ws = wb.getWorksheet("Comparison")!;
    expect(ws.getRow(4).getCell(4).value).toBe("A · Q1 (USD, DDP)");
    expect((await wb.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
    expect(comparisonFileName("UPA/2026:1", "2026-11-22")).toBe("Comparison UPA_2026_1 2026-11-22.xlsx");
    expect(complianceText(undefined)).toBe("Not quoted");
  });
});

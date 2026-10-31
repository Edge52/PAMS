import { describe, expect, it } from "vitest";
import { crossedMinimum, movementProblem, partsUsed, reorderQty, signedQty, stockState } from "./parts";
import { criteriaProblem, matchRecall, parseSerials, recallProgress, type MatchAsset } from "./recalls";

describe("spare parts", () => {
  it("knows stock state and reorder quantity", () => {
    expect(stockState(0, 2)).toBe("OUT");
    expect(stockState(2, 2)).toBe("LOW");
    expect(stockState(3, 2)).toBe("OK");
    expect(reorderQty(1, 3)).toBe(5);
    expect(reorderQty(0, 0)).toBe(1);
    expect(reorderQty(9, 3)).toBe(0);
  });
  it("signs movements", () => {
    expect(signedQty("ISSUE", 2)).toBe(-2);
    expect(signedQty("RECEIPT", 2)).toBe(2);
    expect(signedQty("RETURN", 1)).toBe(1);
    expect(signedQty("ADJUSTMENT", -3)).toBe(-3);
  });
  it("refuses impossible movements", () => {
    expect(movementProblem("ISSUE", 3, 2)).toBe("Only 2 in stock.");
    expect(movementProblem("ISSUE", 0, 2)).toMatch(/whole quantity/);
    expect(movementProblem("RECEIPT", -1, 2)).toMatch(/positive/);
    expect(movementProblem("ADJUSTMENT", -5, 2)).toMatch(/below zero/);
    expect(movementProblem("RETURN", 2, 0, 1)).toMatch(/Only 1/);
    expect(movementProblem("ADJUSTMENT", -2, 2)).toBeNull();
    expect(movementProblem("RETURN", 1, 0, 1)).toBeNull();
  });
  it("totals parts used on a job, net of returns", () => {
    const u = partsUsed([
      { partId: 1, kind: "ISSUE", quantity: -2, unitCost: "150.00" },
      { partId: 1, kind: "RETURN", quantity: 1, unitCost: "150.00" },
      { partId: 2, kind: "ISSUE", quantity: -1, unitCost: 80 },
      { partId: 3, kind: "RECEIPT", quantity: 10, unitCost: 5 },
    ]);
    expect(u.byPart.get(1)).toEqual({ qty: 1, cost: 150 });
    expect(u.total).toBe(230);
  });
  it("notices crossing the minimum only once", () => {
    expect(crossedMinimum(3, 2, 2)).toBe(true);
    expect(crossedMinimum(2, 1, 2)).toBe(false);
    expect(crossedMinimum(5, 4, 2)).toBe(false);
  });
});

describe("recalls", () => {
  const a = (id: number, o: Partial<MatchAsset> = {}): MatchAsset =>
    ({ id, deviceTypeId: 10, manufacturer: "Dräger", model: "Evita V500", serialNumber: `SN${id}`, status: "IN_SERVICE", ...o });
  const list = [a(1), a(2, { model: "Evita V300" }), a(3, { manufacturer: "Hamilton", model: "C6" }), a(4, { status: "DISPOSED" }), a(5, { deviceTypeId: 11 })];
  it("needs at least one criterion", () => {
    expect(criteriaProblem({})).toMatch(/at least/);
    expect(criteriaProblem({ manufacturer: "  " })).toMatch(/at least/);
    expect(criteriaProblem({ deviceTypeId: 3 })).toBeNull();
  });
  it("matches type, manufacturer, model and serials together, ignoring case and dashes", () => {
    expect(matchRecall({ deviceTypeId: 10, manufacturer: "dräger" }, list).map((x) => x.id)).toEqual([1, 2]);
    expect(matchRecall({ manufacturer: "Dräger", modelPattern: "evita-v500" }, list).map((x) => x.id)).toEqual([1, 5]);
    expect(matchRecall({ modelPattern: "Evita", serialNumbers: ["sn2", "SN-5"] }, list).map((x) => x.id)).toEqual([2, 5]);
    expect(matchRecall({ deviceTypeId: 10 }, list).map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it("parses serial lists", () => {
    expect(parseSerials("A1\nA2, A3;A1\n\n")).toEqual(["A1", "A2", "A3"]);
    expect(parseSerials(null)).toEqual([]);
  });
  it("tracks progress", () => {
    expect(recallProgress([{ status: "PENDING" }, { status: "ACTIONED" }, { status: "NOT_AFFECTED" }, { status: "ACTIONED" }]))
      .toEqual({ total: 4, pending: 1, actioned: 2, notAffected: 1, pct: 75, done: false });
    expect(recallProgress([]).done).toBe(true);
  });
});

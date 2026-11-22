import { describe, expect, it } from "vitest";
import { BUYER_PAYS, landedCost } from "./landed-cost";
import { INCOTERMS } from "./labels";

const defaults = { freightPct: 5, insurancePct: 0.5, dutyPct: 2, clearancePct: 1, localDeliveryPct: 1 };

describe("landedCost", () => {
  it("adds nothing to a DDP price", () => {
    const r = landedCost("DDP", 10000, { freight: 500 }, defaults);
    expect(r.landed).toBe(10000);
    expect(r.factor).toBe(1);
    expect(r.ignored).toEqual(["freight"]);
  });

  it("uses every default on EXW, duty on the CIF value", () => {
    const r = landedCost("EXW", 10000, {}, defaults);
    // freight 500, insurance 50, duty 2 % of 10550 = 211, clearance 100, local 100
    expect(r.parts.map((p) => [p.part, p.amount])).toEqual([["freight", 500], ["insurance", 50], ["duty", 211], ["clearance", 100], ["localDelivery", 100]]);
    expect(r.landed).toBe(10961);
    expect(r.factor).toBeCloseTo(1.0961, 6);
  });

  it("prefers what the offer states over the defaults", () => {
    const r = landedCost("FOB", 10000, { freight: 800, insurance: 0, dutyPct: 0, clearance: 250 }, defaults);
    expect(r.parts.map((p) => [p.part, p.amount, p.source])).toEqual([["freight", 800, "offer"], ["insurance", 0, "offer"], ["clearance", 250, "offer"], ["localDelivery", 100, "default"]]);
    expect(r.landed).toBe(11150);
  });

  it("CIF and CIP carry duty on the price, clearance and local delivery", () => {
    const r = landedCost("CIP", 20000, {}, defaults);
    expect(r.parts.map((p) => p.part)).toEqual(["duty", "clearance", "localDelivery"]);
    expect(r.extra).toBe(400 + 200 + 200);
  });

  it("DAP and DPU leave only import duty and clearance", () => {
    for (const t of ["DAP", "DPU"] as const) expect(landedCost(t, 1000, {}, defaults).parts.map((p) => p.part)).toEqual(["duty", "clearance"]);
  });

  it("without an Incoterm adds only what the offer states, and flags it", () => {
    const r = landedCost(null, 1000, { clearance: 30 }, defaults);
    expect(r.termMissing).toBe(true);
    expect(r.landed).toBe(1030);
    expect(landedCost(undefined, 1000, {}, defaults).landed).toBe(1000);
  });

  it("covers every Incoterm, and a zero price keeps factor 1", () => {
    for (const t of INCOTERMS) expect(BUYER_PAYS[t]).toBeDefined();
    expect(landedCost("EXW", 0, { freight: 100 }, defaults).factor).toBe(1);
  });
});

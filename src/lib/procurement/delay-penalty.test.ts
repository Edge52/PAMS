import { describe, expect, it } from "vitest";
import {
  contractTypeOf, deductionProblem, DEFAULT_PENALTY_SETTINGS, delayPenalty, deliveryPeriodDays, LAW_PENALTY_RULES, penaltyLeft, penaltyNote,
  penaltyPct, penaltySettingsProblem, penaltyTerms, rulesFromSettings, supplyStepPct, waiverProblem, weeksLate, worksCapPct,
  type PenaltyTerms,
} from "./delay-penalty";

/** Works terms with the wave 37 figures (1 % a week, cap 15 %), to keep the weekly calculation covered. */
const works: PenaltyTerms = penaltyTerms({ contractType: "WORKS", delayPenaltyCapPct: 15 }, LAW_PENALTY_RULES, null);
const supply = (periodDays: number, extra: Partial<PenaltyTerms> = {}): PenaltyTerms => ({ ...penaltyTerms({}, LAW_PENALTY_RULES, periodDays), ...extra });
const line = { id: 1, description: "Monitor", quantity: 10, unitPrice: 1000 };
const all = (date: string, quantity = 10) => [{ date, lines: [{ poLineId: 1, quantity }] }];

describe("weeksLate and the delivery period", () => {
  it("counts a started week as a week", () => {
    expect(weeksLate("2026-10-01", "2026-10-01")).toEqual({ days: 0, weeks: 0 });
    expect(weeksLate("2026-10-01", "2026-09-20")).toEqual({ days: 0, weeks: 0 });
    expect(weeksLate("2026-10-01", "2026-10-02")).toEqual({ days: 1, weeks: 1 });
    expect(weeksLate("2026-10-01", "2026-10-08")).toEqual({ days: 7, weeks: 1 });
    expect(weeksLate("2026-10-01", "2026-10-09")).toEqual({ days: 8, weeks: 2 });
  });
  it("is the days from the order to the expected delivery, at least 1", () => {
    expect(deliveryPeriodDays("2026-07-01", "2026-10-09")).toBe(100);
    expect(deliveryPeriodDays("2026-10-01", "2026-10-01")).toBe(1);
    expect(deliveryPeriodDays(null, "2026-10-01")).toBeNull();
  });
});

describe("supply and services steps (Law 182 art. 48, Reg. art. 98(2))", () => {
  it("steps at 3, 6 and 10 % of the period, boundaries included", () => {
    const r = LAW_PENALTY_RULES;
    expect(supplyStepPct(r, 0)).toBe(0);
    expect(supplyStepPct(r, 0.1)).toBe(1);
    expect(supplyStepPct(r, 3)).toBe(1);
    expect(supplyStepPct(r, 3.01)).toBe(2);
    expect(supplyStepPct(r, 6)).toBe(2);
    expect(supplyStepPct(r, 6.5)).toBe(3);
    expect(supplyStepPct(r, 10)).toBe(3);
    expect(supplyStepPct(r, 10.01)).toBe(5);
    expect(supplyStepPct(r, 400)).toBe(5);
    expect(supplyStepPct(r, null)).toBe(5);
  });
  it("works out the step from days late on a 100-day period", () => {
    const t = supply(100);
    expect(penaltyPct(t, 3)).toMatchObject({ pct: 1, sharePct: 3 });
    expect(penaltyPct(t, 4)).toMatchObject({ pct: 2 });
    expect(penaltyPct(t, 6)).toMatchObject({ pct: 2 });
    expect(penaltyPct(t, 7)).toMatchObject({ pct: 3 });
    expect(penaltyPct(t, 10)).toMatchObject({ pct: 3 });
    expect(penaltyPct(t, 11)).toMatchObject({ pct: 5, capped: false });
    expect(penaltyPct(t, 0)).toMatchObject({ pct: 0 });
  });
  it("services follow the same steps; a lower cap on the order wins", () => {
    expect(penaltyPct(supply(100, { contractType: "SERVICES" }), 8).pct).toBe(3);
    const capped = penaltyTerms({ delayPenaltyCapPct: 2 }, LAW_PENALTY_RULES, 100);
    expect(penaltyPct(capped, 50)).toMatchObject({ pct: 2, capPct: 2, capped: true });
  });
  it("charges the late units only: 4 of 10 delivered 5 days late on a 100-day order = 2 %", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", lines: [line], terms: supply(100), asOf: "2026-12-01",
      deliveries: [{ date: "2026-09-30", lines: [{ poLineId: 1, quantity: 6 }] }, { date: "2026-10-06", lines: [{ poLineId: 1, quantity: 4 }] }],
    });
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ units: 4, daysLate: 5, sharePct: 5, pct: 2, amount: 80 });
    expect(r.basis).toBe("LATE_ITEMS");
    expect(r.lateValue).toBe(4000);
  });
  it("puts the penalty on the whole order when the late part prevents use", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", lines: [line, { id: 2, description: "Cable", quantity: 1, unitPrice: 500 }], asOf: "2026-12-01",
      terms: supply(100, { blocksUse: true }),
      deliveries: [{ date: "2026-09-30", lines: [{ poLineId: 1, quantity: 10 }] }, { date: "2026-10-21", lines: [{ poLineId: 2, quantity: 1 }] }],
    });
    expect(r.basis).toBe("WHOLE_ORDER");
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0]).toMatchObject({ poLineId: 0, value: 10500, daysLate: 20, pct: 5, amount: 525 });
    expect(r.amount).toBe(525);
  });
  it("is nothing without an expected date or when on time", () => {
    expect(delayPenalty({ expectedDelivery: null, lines: [line], deliveries: [], terms: supply(30), asOf: "2026-12-01" }).amount).toBe(0);
    const r = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: all("2026-10-01"), terms: supply(30, { blocksUse: true }), asOf: "2026-12-01" });
    expect(r.amount).toBe(0);
    expect(r.parts).toEqual([]);
  });
});

describe("works (weekly rate, settings-driven caps)", () => {
  it("caps at 10 %, or 15 % when the delay is more than 10 % of the period", () => {
    const r = LAW_PENALTY_RULES;
    expect(worksCapPct(r, 10)).toBe(10);
    expect(worksCapPct(r, 10.5)).toBe(15);
    expect(worksCapPct(r, null)).toBe(10);
    const t = penaltyTerms({ contractType: "WORKS" }, r, 365);
    // 84 days = 12 weeks = 12 %, 23 % of the period → cap 15 %
    expect(penaltyPct(t, 84)).toMatchObject({ pct: 12, capPct: 15, capped: false });
    // 15 weeks on a long period (7 % of 1500 days) → cap 10 %
    expect(penaltyPct(penaltyTerms({ contractType: "WORKS" }, r, 1500), 105)).toMatchObject({ pct: 10, capPct: 10, capped: true });
  });
  it("takes the caps and rate from settings", () => {
    const rules = rulesFromSettings({ ...DEFAULT_PENALTY_SETTINGS, delayPenaltyRatePct: 2, delayWorksLongCapPct: 20 });
    expect(penaltyPct(penaltyTerms({ contractType: "WORKS" }, rules, 70), 35)).toMatchObject({ weeks: 5, pct: 10 });
    expect(penaltyPct(penaltyTerms({ contractType: "WORKS" }, rules, 70), 70)).toMatchObject({ pct: 20, capped: false });
  });
  it("counts a partial delivery by weeks", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", lines: [line], terms: works, asOf: "2026-12-01",
      deliveries: [{ date: "2026-09-30", lines: [{ poLineId: 1, quantity: 6 }] }, { date: "2026-10-16", lines: [{ poLineId: 1, quantity: 4 }] }],
    });
    expect(r.parts[0]).toMatchObject({ units: 4, weeks: 3, pct: 3, amount: 120 });
  });
  it("caps each part at the order's own cap", () => {
    const r = delayPenalty({ expectedDelivery: "2026-01-01", lines: [line], deliveries: all("2026-07-01"), terms: works, asOf: "2026-12-01" });
    expect(r.parts[0]).toMatchObject({ weeks: 26, pct: 15, capped: true });
    expect(r.amount).toBe(1500);
  });
  it("counts outstanding units up to asOf on an open order, and not on a closed one", () => {
    const base = { expectedDelivery: "2026-11-01", lines: [line], terms: works, asOf: "2026-11-10", deliveries: all("2026-10-30", 5) };
    const open = delayPenalty(base);
    expect(open.provisional).toBe(true);
    expect(open.parts[0]).toMatchObject({ units: 5, deliveredOn: null, daysLate: 9, weeks: 2, amount: 100 });
    expect(delayPenalty({ ...base, countOutstanding: false }).amount).toBe(0);
  });
  it("ignores deliveries beyond the ordered quantity and handles several lines", () => {
    const r = delayPenalty({
      expectedDelivery: "2026-10-01", terms: penaltyTerms({ contractType: "WORKS", delayPenaltyRatePct: 0.5 }, LAW_PENALTY_RULES, null), asOf: "2026-10-05",
      lines: [{ id: 1, description: "A", quantity: 2, unitPrice: 100 }, { id: 2, description: "B", quantity: 1, unitPrice: 50 }],
      deliveries: [{ date: "2026-10-03", lines: [{ poLineId: 1, quantity: 5 }, { poLineId: 2, quantity: 1 }] }],
    });
    expect(r.parts.map((p) => [p.poLineId, p.units, p.amount])).toEqual([[1, 2, 1], [2, 1, 0.25]]);
    expect(r.amount).toBe(1.25);
  });
});

describe("notes, waiver, terms and deductions", () => {
  it("writes a note that shows the calculation", () => {
    const w = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: all("2026-10-10"), terms: works, asOf: "2026-12-01" });
    const note = penaltyNote(w, (n) => n.toFixed(2));
    expect(note).toContain("10 × Monitor: delivered 2026-10-10, 9 days late (delivery period unknown) = 2 weeks × 1 % = 2 % of 10000.00 = 200.00");
    expect(note).toContain("Total 200.00.");
    const s = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: all("2026-10-05"), terms: supply(100), asOf: "2026-12-01" });
    expect(penaltyNote(s, (n) => n.toFixed(2))).toContain("4 days late = 4 % of the 100-day period → 2 % of 10000.00 = 200.00");
  });
  it("keeps the calculation but deducts nothing when waived", () => {
    const r = delayPenalty({ expectedDelivery: "2026-10-01", lines: [line], deliveries: all("2026-10-05"), terms: supply(100), asOf: "2026-12-01", waivedReason: "Port closed by decree 12/2026" });
    expect(r.grossAmount).toBe(200);
    expect(r.amount).toBe(0);
    expect(r.waived).toBe("Port closed by decree 12/2026");
    expect(penaltyNote(r, (n) => n.toFixed(2))).toContain("waived: Port closed");
    expect(waiverProblem(" ")).toMatch(/reason/);
    expect(waiverProblem("Force majeure: port strike, director's decision 4/2026")).toBeNull();
  });
  it("uses the order's own terms on top of the hospital rules", () => {
    expect(contractTypeOf(null)).toBe("SUPPLY");
    expect(contractTypeOf("WORKS")).toBe("WORKS");
    expect(penaltyTerms({}, LAW_PENALTY_RULES).rules).toEqual(LAW_PENALTY_RULES);
    expect(penaltyTerms({ delayPenaltyRatePct: 0.5 }, LAW_PENALTY_RULES).rules.worksRatePctPerWeek).toBe(0.5);
    expect(penaltyTerms({ delayPenaltyRatePct: -1, delayPenaltyCapPct: 200 }, LAW_PENALTY_RULES).rules).toEqual(LAW_PENALTY_RULES);
  });
  it("checks the settings hold together", () => {
    expect(penaltySettingsProblem(DEFAULT_PENALTY_SETTINGS)).toBeNull();
    expect(rulesFromSettings(DEFAULT_PENALTY_SETTINGS)).toEqual(LAW_PENALTY_RULES);
    expect(penaltySettingsProblem({ ...DEFAULT_PENALTY_SETTINGS, delaySupplyStep2UpToPct: 2 })).toMatch(/go up/);
    expect(penaltySettingsProblem({ ...DEFAULT_PENALTY_SETTINGS, delaySupplyStep3Pct: 1 })).toMatch(/at least/);
    expect(penaltySettingsProblem({ ...DEFAULT_PENALTY_SETTINGS, delaySupplyCapPct: 4 })).toMatch(/supply cap/);
    expect(penaltySettingsProblem({ ...DEFAULT_PENALTY_SETTINGS, delayWorksLongCapPct: 5 })).toMatch(/long delays/);
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

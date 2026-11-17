import { describe, expect, it } from "vitest";
import { contractShare, cosrPct, cosrTone, grandTotal, periodDays, rollUp, yearlyCosr } from "./service-cost-calc";

describe("contract share", () => {
  it("takes the part of the contract inside the period, split per device", () => {
    // A 365-day contract worth 36,500 over 2 devices; the period covers 100 of its days.
    expect(contractShare({ value: 36_500, start: "2026-01-01", end: "2026-12-31", devices: 2 }, "2026-01-01", "2026-04-10")).toBeCloseTo(5000, 0);
    expect(contractShare({ value: 1000, start: "2025-01-01", end: "2025-12-31", devices: 1 }, "2026-01-01", "2026-06-30")).toBe(0);
    expect(contractShare({ value: null, start: "2026-01-01", end: "2026-12-31", devices: 1 }, "2026-01-01", "2026-12-31")).toBe(0);
    // A contract that covers no device yet still counts once.
    expect(contractShare({ value: 1200, start: "2026-01-01", end: "2026-12-31", devices: 0 }, "2026-01-01", "2026-12-31")).toBe(1200);
  });
});

describe("COSR", () => {
  it("is service cost over acquisition cost", () => {
    expect(cosrPct(5000, 100_000)).toBe(5);
    expect(cosrPct(5000, 0)).toBeNull();
  });
  it("scales a part-year period to a year", () => {
    expect(periodDays("2026-01-01", "2026-12-31")).toBe(365);
    expect(yearlyCosr(3, periodDays("2026-01-01", "2026-06-30"))).toBeCloseTo(6.1, 1);
    expect(yearlyCosr(null, 100)).toBeNull();
  });
  it("reads the guide as a tone", () => {
    expect(cosrTone(4.5)).toBe("ok");
    expect(cosrTone(8)).toBe("warn");
    expect(cosrTone(15)).toBe("danger");
    expect(cosrTone(null)).toBeNull();
  });
});

describe("roll-ups", () => {
  const devices = [
    { id: 1, acquisition: 100_000, type: "Monitor" },
    { id: 2, acquisition: 100_000, type: "Monitor" },
    { id: 3, acquisition: null, type: "Pump" },
    { id: 4, acquisition: 50_000, type: "Pump" },
  ];
  const lines = [
    { assetId: 1, amount: 3000, source: "IN_HOUSE" as const },
    { assetId: 2, amount: 2000, source: "CONTRACT" as const },
    { assetId: 2, amount: 1000, source: "IN_HOUSE" as const },
    { assetId: 3, amount: 900, source: "IN_HOUSE" as const },
    { assetId: 4, amount: 5000, source: "CONTRACT" as const },
  ];
  it("adds in-house and contract cost per group, highest first", () => {
    const rows = rollUp(devices, lines, (d) => ({ key: d.type, label: d.type }), 365);
    expect(rows.map((r) => r.label)).toEqual(["Monitor", "Pump"]);
    expect(rows[0]).toMatchObject({ devices: 2, priced: 2, acquisition: 200_000, inHouse: 4000, contract: 2000, total: 6000, cosr: 3 });
  });
  it("keeps devices without a price out of the ratio but in the total", () => {
    const pump = rollUp(devices, lines, (d) => ({ key: d.type, label: d.type }), 365)[1];
    expect(pump).toMatchObject({ devices: 2, priced: 1, total: 5900, unpricedService: 900, acquisition: 50_000, cosr: 10 });
  });
  it("gives a grand total", () => {
    const t = grandTotal(devices, lines, 365);
    expect(t).toMatchObject({ devices: 4, total: 11_900, inHouse: 4900, contract: 7000, unpricedService: 900 });
    expect(t.cosr).toBeCloseTo(4.4, 1); // 11,000 / 250,000
    expect(grandTotal([], [], 365).cosr).toBeNull();
  });
});

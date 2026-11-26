import { describe, expect, it } from "vitest";
import { bestOf, hospitalKpis, type HospitalIn } from "./compare";

const h = (over: Partial<HospitalIn> = {}): HospitalIn => ({
  id: 1, name: "A", beds: 100, devices: 200, ppmDue: 50, ppmOnTime: 40, openJobs: 10, downtimeHours: 100, deviceHours: 10_000,
  serviceCost: 50_000, acquisition: 1_000_000, pricedDevices: 150, spend: 2_000_000, ...over,
});

describe("compare hospitals", () => {
  it("normalises per bed and per device", () => {
    const k = hospitalKpis(h(), 365.25, true);
    expect(k.perBed!.value).toBe(2);
    expect(k.ppm!.value).toBe(0.8);
    expect(k.openJobs!.value).toBe(5);
    expect(k.uptime!.value).toBeCloseTo(0.99);
    expect(k.cosr!.value).toBeCloseTo(0.05);
    expect(k.spendPerBed!.value).toBe(20_000);
  });

  it("hides prices without prices.view and small counts", () => {
    const k = hospitalKpis(h({ ppmDue: 3, ppmOnTime: 3, beds: 0 }), 365, false);
    expect(k.cosr).toBeNull();
    expect(k.spendPerBed).toBeNull();
    expect(k.ppm!.value).toBeNull();
    expect(k.ppm!.n).toBe(3);
    expect(k.perBed!.value).toBeNull();
  });

  it("picks the best hospital only when it is clear", () => {
    const rows = [hospitalKpis(h(), 365, true), hospitalKpis(h({ openJobs: 2 }), 365, true)];
    expect(bestOf(rows, "openJobs")).toBe(1);
    expect(bestOf(rows, "ppm")).toBeNull(); // a tie
    expect(bestOf(rows, "devices")).toBeNull();
    expect(bestOf([rows[0]], "openJobs")).toBeNull();
  });
});

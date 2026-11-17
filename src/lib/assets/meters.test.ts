import { describe, expect, it } from "vitest";
import { nextPpmDue } from "./maintenance";
import { averageDailyUse, readingProblem, readingsFromMonthlyCounts, usageAt, usagePoints, usagePpmDue, type MeterReading } from "./meters";

const r = (readOn: string, reading: number, kind: "READING" | "RESET" = "READING"): MeterReading => ({ readOn, reading, kind });

describe("readingProblem", () => {
  const hist = [r("2026-01-01", 100), r("2026-03-01", 400)];
  it("accepts a reading that goes up", () => {
    expect(readingProblem(hist, r("2026-04-01", 450))).toBeNull();
    expect(readingProblem(hist, r("2026-04-01", 400))).toBeNull();
  });
  it("refuses a reading that goes backwards", () => {
    expect(readingProblem(hist, r("2026-04-01", 350))).toMatch(/can't go backwards/);
  });
  it("allows a lower figure when the meter was reset or replaced", () => {
    expect(readingProblem(hist, r("2026-04-01", 0, "RESET"))).toBeNull();
  });
  it("checks a back-dated reading against the later one", () => {
    expect(readingProblem(hist, r("2026-02-01", 500))).toMatch(/later reading/);
    expect(readingProblem(hist, r("2026-02-01", 250))).toBeNull();
  });
  it("refuses a negative figure", () => {
    expect(readingProblem([], r("2026-01-01", -1))).toMatch(/0 or more/);
  });
});

describe("usagePoints", () => {
  it("counts use across a meter reset", () => {
    const pts = usagePoints([r("2026-01-01", 100), r("2026-02-01", 300), r("2026-02-01", 0, "RESET"), r("2026-03-01", 50)]);
    expect(pts).toEqual([{ date: "2026-01-01", total: 0 }, { date: "2026-02-01", total: 200 }, { date: "2026-03-01", total: 250 }]);
  });
  it("interpolates between readings", () => {
    const pts = usagePoints([r("2026-01-01", 0), r("2026-01-11", 100)]);
    expect(usageAt(pts, "2026-01-06")).toBe(50);
    expect(usageAt(pts, "2025-12-01")).toBe(0);
    expect(usageAt(pts, "2026-02-01")).toBe(100);
  });
});

describe("averageDailyUse", () => {
  it("needs readings at least a day apart", () => {
    expect(averageDailyUse(usagePoints([r("2026-01-01", 5)]))).toBeNull();
  });
  it("uses the last 180 days", () => {
    // 1 a day to October, then 10 a day: the October reading is the last one at or before the window start.
    const pts = usagePoints([r("2025-01-01", 0), r("2025-10-01", 273), r("2026-04-10", 2183)]);
    expect(averageDailyUse(pts)).toBeCloseTo(10, 5);
  });
});

describe("usagePpmDue", () => {
  it("estimates the date from the average use since the last PPM", () => {
    // A ventilator: 24 h a day, PPM every 5,000 hours, last PPM on 1 Jan.
    const d = usagePpmDue({ readings: [r("2026-01-01", 10_000), r("2026-03-02", 11_440)], interval: 5000, unit: "hours", lastPpmDate: "2026-01-01" });
    expect(d.usedSince).toBe(1440);
    expect(d.perDay).toBe(24);
    expect(d.due).toBe("2026-07-29"); // 3,560 hours left at 24 a day = 149 days after 2 March
    expect(d.countedFrom).toBe("last_ppm");
  });
  it("finds the day the interval ran out when it already has", () => {
    const d = usagePpmDue({ readings: [r("2026-01-01", 0), r("2026-01-11", 1000), r("2026-01-21", 2000)], interval: 1500, unit: "scans", installDate: "2026-01-01" });
    expect(d.remaining).toBe(-500);
    expect(d.due).toBe("2026-01-16");
  });
  it("counts from the first reading when the PPM is older than every reading", () => {
    const d = usagePpmDue({ readings: [r("2026-05-01", 900), r("2026-05-11", 1000)], interval: 1000, unit: "cycles", lastPpmDate: "2026-01-01" });
    expect(d.countedFrom).toBe("first_reading");
    expect(d.usedSince).toBe(100);
    expect(d.due).toBe("2026-08-09");
  });
  it("gives no date without readings or without use", () => {
    expect(usagePpmDue({ readings: [], interval: 100, unit: "hours" }).due).toBeNull();
    expect(usagePpmDue({ readings: [r("2026-01-01", 5), r("2026-02-01", 5)], interval: 100, unit: "hours" }).due).toBeNull();
  });
});

describe("whichever comes first", () => {
  it("takes the usage date when it is earlier than the months interval", () => {
    const n = nextPpmDue({ id: 1, installDate: "2026-01-01", ppmIntervalMonths: 12, usageDue: "2026-07-29" });
    expect(n).toMatchObject({ due: "2026-07-29", basis: "usage" });
  });
  it("keeps the months date when it is earlier", () => {
    const n = nextPpmDue({ id: 1, lastPpmDate: "2026-01-01", ppmIntervalMonths: 6, usageDue: "2026-09-01" });
    expect(n).toMatchObject({ due: "2026-07-01", basis: "last_ppm" });
  });
});

describe("readingsFromMonthlyCounts", () => {
  it("turns monthly exams into a running meter", () => {
    expect(readingsFromMonthlyCounts([{ month: "2026-02-01", exams: 300 }, { month: "2026-01-01", exams: 200 }], "2026-11-17")).toEqual([
      r("2026-01-01", 0), r("2026-01-31", 200), r("2026-02-28", 500),
    ]);
  });
  it("never dates a reading after today", () => {
    expect(readingsFromMonthlyCounts([{ month: "2026-11-01", exams: 50 }], "2026-11-17").at(-1)).toEqual(r("2026-11-17", 50));
  });
});

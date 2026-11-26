import { describe, expect, it } from "vitest";
import { BENCHMARK, byModality, modalityOf, scannerCapacity, weekdayAverages, weekdayIndex, weekdayMonthHeatmap } from "./imaging";

describe("imaging analytics", () => {
  it("reads the modality from the type code", () => {
    expect(modalityOf("IMG-CT-128")).toBe("CT");
    expect(modalityOf("IMG-MRI-15T")).toBe("MRI");
    expect(modalityOf("MON-PAT")).toBe("OTHER");
  });

  it("puts days in weekday × month cells with averages per day", () => {
    expect(weekdayIndex("2026-11-23")).toBe(0); // a Monday
    expect(weekdayIndex("2026-11-29")).toBe(6);
    const h = weekdayMonthHeatmap([
      { day: "2026-11-23", exams: 10 }, { day: "2026-11-23", exams: 5 }, // two scanners, one day
      { day: "2026-11-30", exams: 25 }, { day: "2026-11-24", exams: 4 }, { day: "bad", exams: 9 },
    ]);
    expect(h.days).toBe(3);
    expect(h.exams).toBe(44);
    expect(h.rows[0][10]).toEqual({ exams: 40, days: 2, avg: 20 });
    expect(h.rows[1][10].avg).toBe(4);
    expect(h.rows[2][10].avg).toBeNull();
    expect(h.max).toBe(20);
    expect(weekdayAverages(h)[0].avg).toBe(20);
  });

  it("works out idle capacity and exams a year", () => {
    const ct = scannerCapacity({ id: 1, tag: "CT-1", typeCode: "IMG-CT-64", typeName: "CT", exams: 4000, months: 6, capacityPerYear: null });
    expect(ct.capacity).toBe(6000); // 12,000 a year for 6 months
    expect(ct.capacitySource).toBe("hint");
    expect(ct.idle).toBe(2000);
    expect(ct.idleShare).toBeCloseTo(1 / 3);
    expect(ct.perYear).toBe(8000);
    expect(ct.vsBenchmark).toBeCloseTo(8000 / BENCHMARK.CT);
    const mri = scannerCapacity({ id: 2, tag: "MR-1", typeCode: "IMG-MRI-15T", typeName: "MRI", exams: 7000, months: 12, capacityPerYear: 6500 });
    expect(mri.capacitySource).toBe("hospital");
    expect(mri.idle).toBe(0);
    const none = scannerCapacity({ id: 3, tag: "X", typeCode: "IMG-FLU", typeName: "Fluoro", exams: 0, months: 0, capacityPerYear: null });
    expect(none.capacity).toBeNull();
    expect(none.perYear).toBeNull();
    const g = byModality([ct, mri, none]);
    expect(g.map((x) => x.modality)).toEqual(["CT", "MRI"]);
    expect(g[0].idleShare).toBeCloseTo(1 / 3);
  });
});

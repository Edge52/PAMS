import { describe, expect, it } from "vitest";
import { defaultCounter, isTubeType, tubeForecast, tubeReadingProblem, type Tube } from "./tubes";

const ct: Tube = { installedOn: "2026-01-01", counterAtInstall: 100_000, warrantyMonths: 12, warrantyCounter: 150_000, expectedLife: 300_000 };

describe("tube life", () => {
  it("knows which types have a tube and their counter", () => {
    expect(isTubeType("IMG-CT-128")).toBe(true);
    expect(isTubeType("IMG-XR-CARM")).toBe(true);
    expect(isTubeType("IMG-XR-CR")).toBe(false);
    expect(isTubeType("IMG-MRI-15T")).toBe(false);
    expect(defaultCounter("IMG-CT-64")).toBe("scan_seconds");
    expect(defaultCounter("IMG-XR-DR")).toBe("exposures");
  });

  it("forecasts from the rate of use", () => {
    // 500 scan seconds a day since fitting.
    const f = tubeForecast(ct, [{ readOn: "2026-05-01", counter: 160_000 }, { readOn: "2026-11-01", counter: 252_000 }], "2026-11-02");
    expect(f.used).toBe(152_000);
    expect(f.perDay).toBeCloseTo(500, 0);
    // Counter warranty (150,000) ran out before 12 months.
    expect(f.warrantyBy).toBe("counter");
    expect(f.warrantyEnd! < "2026-11-01").toBe(true);
    expect(f.lifeUsed).toBeCloseTo(0.5067, 3);
    expect(f.replaceBy).toBe("2027-08-24"); // 148,000 left at 500 a day = 296 days
    expect(f.state).toBe("out_of_warranty");
  });

  it("warns within the weeks before replacement and past the expected life", () => {
    const rs = [{ readOn: "2026-11-01", counter: 380_000 }];
    expect(tubeForecast(ct, rs, "2026-11-02").state).toBe("replace_soon");
    expect(tubeForecast(ct, [{ readOn: "2026-11-01", counter: 400_000 }], "2026-11-02").state).toBe("over_life");
  });

  it("ends the warranty on whichever comes first", () => {
    const light = tubeForecast(ct, [{ readOn: "2026-06-01", counter: 101_000 }], "2026-06-02");
    expect(light.warrantyBy).toBe("months");
    expect(light.warrantyEnd).toBe("2027-01-01");
    expect(tubeForecast(ct, [{ readOn: "2026-11-20", counter: 101_000 }], "2026-11-21").state).toBe("warranty_ending");
  });

  it("has no forecast without readings", () => {
    const f = tubeForecast({ ...ct, warrantyMonths: null }, [], "2026-02-01");
    expect(f).toMatchObject({ used: 0, perDay: null, replaceBy: null, state: "no_readings", warrantyEnd: null });
    expect(tubeForecast({ ...ct, removedOn: "2026-10-01" }, [], "2026-11-01").state).toBe("removed");
  });

  it("checks readings", () => {
    const rs = [{ readOn: "2026-05-01", counter: 160_000 }];
    expect(tubeReadingProblem(ct, rs, { readOn: "2026-06-01", counter: 150_000 }, "2026-11-01")).toMatch(/backwards/);
    expect(tubeReadingProblem(ct, rs, { readOn: "2026-04-01", counter: 170_000 }, "2026-11-01")).toMatch(/later reading/);
    expect(tubeReadingProblem(ct, rs, { readOn: "2025-12-01", counter: 170_000 }, "2026-11-01")).toMatch(/before this tube/);
    expect(tubeReadingProblem(ct, [], { readOn: "2026-02-01", counter: 90_000 }, "2026-11-01")).toMatch(/fitted/);
    expect(tubeReadingProblem(ct, rs, { readOn: "2026-06-01", counter: 170_000 }, "2026-11-01")).toBeNull();
  });
});

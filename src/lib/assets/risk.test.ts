import { describe, expect, it } from "vitest";
import { emNumber, makerOnlyReason, monthsBetween, riskLevel, strategyProblems, strategyRefusal, suggestedIntervalMonths } from "./risk";

describe("risk score and maintenance strategy (wave 23)", () => {
  it("adds the three parts, and waits until all are scored", () => {
    expect(emNumber({ riskFunction: 10, riskPhysical: 5, riskMaintenance: 5 })).toBe(20);
    expect(emNumber({ riskFunction: 2, riskPhysical: 1, riskMaintenance: 1 })).toBe(4);
    expect(emNumber({ riskFunction: 10, riskPhysical: 5 })).toBeNull();
  });
  it("puts 12 and over in the programme", () => {
    expect(riskLevel(11)).toBe("low");
    expect(riskLevel(12)).toBe("medium");
    expect(riskLevel(17)).toBe("high");
    expect(riskLevel(null)).toBeNull();
  });
  it("suggests an interval from the maintenance need", () => {
    expect(suggestedIntervalMonths(5)).toBe(6);
    expect(suggestedIntervalMonths(3)).toBe(12);
    expect(suggestedIntervalMonths(1)).toBeNull();
  });
  it("says what is missing or doesn't add up", () => {
    expect(strategyProblems({})).toEqual(["Not scored yet.", "No maintenance strategy chosen."]);
    expect(strategyProblems({ riskFunction: 10, riskPhysical: 5, riskMaintenance: 4, maintenanceStrategy: "MANUFACTURER", strategyReason: "Maker requires it", ppmIntervalMonths: 6 })).toEqual([]);
    expect(strategyProblems({ riskFunction: 10, riskPhysical: 5, riskMaintenance: 4, maintenanceStrategy: "RUN_TO_FAILURE", strategyReason: "x", criticality: "LIFE_SUPPORT" }))
      .toEqual(["Scores 19 (12 or more) but is set to repair when it fails.", "Life support equipment should not run to failure."]);
    expect(strategyProblems({ riskFunction: 2, riskPhysical: 1, riskMaintenance: 1, maintenanceStrategy: "ALTERNATIVE", strategyReason: " " }))
      .toEqual(["The reason for the strategy is not written down.", "Planned maintenance is chosen but no interval is set.", "The evidence or risk basis for the hospital's own schedule is not written down."]);
  });
});

describe("alternative maintenance guard (wave 39; CMS S&C 14-07, Joint Commission)", () => {
  const ok = { newestMonths: 36, fewestPpms: 6 };
  it("knows imaging, radiation, MRI and medical lasers", () => {
    expect(makerOnlyReason("IMG-CT-128")).toMatch(/Imaging and radiation/);
    expect(makerOnlyReason("IMG-XR-MOB")).toMatch(/Imaging/);
    expect(makerOnlyReason("RTH-LIN")).toMatch(/radiation/);
    expect(makerOnlyReason("IMG-MRI-OPEN")).toBe("MRI");
    expect(makerOnlyReason("IMG-MRI")).toBe("MRI");
    expect(makerOnlyReason("SUR-LAS-HOL")).toBe("Medical lasers");
    expect(makerOnlyReason("DRM-LAS-HR")).toBe("Medical lasers");
    expect(makerOnlyReason("SUR-OPH-YAG")).toBe("Medical lasers");
    expect(makerOnlyReason("SUR-OPH-PHACO")).toBeNull();
    expect(makerOnlyReason("IMG-ACC-MRINJ")).toBeNull();
    expect(makerOnlyReason("MON-PAT-HIGH")).toBeNull();
    expect(makerOnlyReason(null)).toBeNull();
  });
  it("refuses the hospital's own schedule and run to failure for them, but not the maker's schedule", () => {
    expect(strategyRefusal({ code: "IMG-MRI", maintenanceStrategy: "ALTERNATIVE", fleet: ok })).toMatch(/MRI must follow the maker's schedule/);
    expect(strategyRefusal({ code: "SUR-LAS-CO2", maintenanceStrategy: "RUN_TO_FAILURE", fleet: ok })).toMatch(/repair when it fails is not allowed/);
    expect(strategyRefusal({ code: "IMG-CT-128", maintenanceStrategy: "MANUFACTURER" })).toBeNull();
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: ok })).toBeNull();
  });
  it("refuses them while the hospital has too little history, by the settings", () => {
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: { newestMonths: 11, fewestPpms: 6 } })).toMatch(/installed 11 months ago/);
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: { newestMonths: 12, fewestPpms: 6 } })).toBeNull();
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "RUN_TO_FAILURE", fleet: { newestMonths: 40, fewestPpms: 1 } })).toMatch(/1 completed planned visit:/);
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: { newestMonths: 40, fewestPpms: 2 } })).toBeNull();
    const rule = { minMonths: 24, minPpms: 4 };
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: { newestMonths: 20, fewestPpms: 6 }, rule })).toMatch(/24 months/);
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: { newestMonths: 30, fewestPpms: 3 }, rule })).toMatch(/until every one has 4/);
    expect(strategyRefusal({ code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: null })).toBeNull();
  });
  it("lists the refusal and missing evidence among the problems", () => {
    const base = { riskFunction: 6, riskPhysical: 3, riskMaintenance: 3, strategyReason: "Our records", ppmIntervalMonths: 24 } as const;
    expect(strategyProblems({ ...base, code: "IMG-MRI", maintenanceStrategy: "ALTERNATIVE", evidence: "5 years, no failures" })).toEqual(["MRI must follow the maker's schedule: the hospital's own schedule is not allowed (CMS S&C 14-07)."]);
    expect(strategyProblems({ ...base, code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: ok })).toEqual(["The evidence or risk basis for the hospital's own schedule is not written down."]);
    expect(strategyProblems({ ...base, code: "MON-PAT-HIGH", maintenanceStrategy: "ALTERNATIVE", fleet: ok, evidence: "40 devices, 5 years of PPM records" })).toEqual([]);
  });
  it("counts whole months", () => {
    expect(monthsBetween("2025-11-26", "2026-11-26")).toBe(12);
    expect(monthsBetween("2025-11-27", "2026-11-26")).toBe(11);
    expect(monthsBetween("2027-01-01", "2026-11-26")).toBe(0);
  });
});

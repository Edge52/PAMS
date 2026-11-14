import { describe, expect, it } from "vitest";
import { emNumber, riskLevel, strategyProblems, suggestedIntervalMonths } from "./risk";

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
      .toEqual(["The reason for the strategy is not written down.", "Planned maintenance is chosen but no interval is set."]);
  });
});

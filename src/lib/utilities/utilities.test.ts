import { describe, expect, it } from "vitest";
import { defaultsFor, dueRows, everyText, failureTitle, judgeTest, kindForTypeCode, testDue } from "./utilities";

describe("utility tests (wave 41, EFS.11)", () => {
  const gen = { kind: "GENERATOR", ratedKw: 500, minFuelPct: 60 };
  it("passes a generator load test at 30 % for 30 minutes with a 10 s transfer", () => {
    expect(judgeTest(gen, "GEN_LOAD", { loadKw: 150, durationMin: 30, transferSec: 10, checksOk: true })).toEqual({ passed: true, problems: [], missing: [] });
  });
  it("fails a short, light or slow load test and says why", () => {
    const r = judgeTest(gen, "GEN_LOAD", { loadKw: 100, durationMin: 20, transferSec: 14, checksOk: true });
    expect(r.passed).toBe(false);
    expect(r.problems).toHaveLength(3);
    expect(r.problems.join(" ")).toMatch(/14 s/);
  });
  it("asks for missing readings", () => {
    const r = judgeTest(gen, "GEN_LOAD", { loadKw: 200 });
    expect(r.passed).toBe(false);
    expect(r.missing).toEqual(["Checks", "Run time (minutes)", "Transfer time (seconds)"]);
  });
  it("runs without load: needs a run and the checks", () => {
    expect(judgeTest(gen, "GEN_NO_LOAD", { durationMin: 10, checksOk: true }).passed).toBe(true);
    expect(judgeTest(gen, "GEN_NO_LOAD", { durationMin: 10, checksOk: false }).problems).toEqual(["Problem found during the test."]);
  });
  it("checks fuel against the system's minimum, else 50 %", () => {
    expect(judgeTest(gen, "FUEL", { fuelPct: 55 }).passed).toBe(false);
    expect(judgeTest({ kind: "GENERATOR" }, "FUEL", { fuelPct: 55 }).passed).toBe(true);
  });
  it("checks UPS autonomy against the minutes needed (default 10)", () => {
    expect(judgeTest({ kind: "UPS" }, "UPS_AUTONOMY", { autonomyMin: 8, checksOk: true }).passed).toBe(false);
    expect(judgeTest({ kind: "UPS", requiredMinutes: 5 }, "UPS_AUTONOMY", { autonomyMin: 8, checksOk: true }).passed).toBe(true);
  });
  it("flags cold-chain excursions, with 2–6 °C for blood fridges", () => {
    expect(defaultsFor("COLD_CHAIN", "BBK-STO-REF")).toMatchObject({ tempLow: 2, tempHigh: 6 });
    expect(judgeTest({ kind: "COLD_CHAIN" }, "COLD_CHAIN", { tempMin: 3, tempMax: 7.5, excursionMin: 0 }).passed).toBe(true);
    expect(judgeTest({ kind: "COLD_CHAIN", tempLow: 2, tempHigh: 6 }, "COLD_CHAIN", { tempMin: 3, tempMax: 7.5 }).passed).toBe(false);
    expect(judgeTest({ kind: "COLD_CHAIN" }, "COLD_CHAIN", { tempMin: 3, tempMax: 7, excursionMin: 25 }).problems[0]).toMatch(/25 minutes/);
  });
  it("checks theatre and isolation air changes and pressure", () => {
    expect(judgeTest({ kind: "HVAC_THEATRE" }, "HVAC_CHECK", { airChanges: 22, pressurePa: 10 }).passed).toBe(true);
    expect(judgeTest({ kind: "HVAC_THEATRE" }, "HVAC_CHECK", { airChanges: 15, pressurePa: 1 }).problems).toHaveLength(2);
    expect(judgeTest({ kind: "HVAC_ISOLATION" }, "HVAC_CHECK", { airChanges: 12, pressurePa: -3 }).passed).toBe(true);
    expect(judgeTest({ kind: "HVAC_ISOLATION" }, "HVAC_CHECK", { airChanges: 12, pressurePa: 2 }).passed).toBe(false);
  });
  it("maps device types to kinds", () => {
    expect(kindForTypeCode("UTL-PWR-GEN")).toBe("GENERATOR");
    expect(kindForTypeCode("PHA-CLD-VAC")).toBe("COLD_CHAIN");
    expect(kindForTypeCode("UTL-XYZ")).toBe("OTHER");
    expect(kindForTypeCode("MON-PAT-HIGH")).toBeNull();
  });
  it("works out what is due", () => {
    expect(testDue(null, 7, "2026-11-27").state).toBe("never");
    expect(testDue("2026-11-20", 7, "2026-11-27")).toEqual({ state: "due", dueOn: "2026-11-27", daysLate: 0 });
    expect(testDue("2026-11-10", 7, "2026-11-27")).toMatchObject({ state: "overdue", daysLate: 10 });
    expect(testDue("2026-11-01", 30, "2026-11-27").state).toBe("soon");
    expect(testDue("2026-11-20", 30, "2026-11-27").state).toBe("ok");
    const last = new Map([["1|GEN_LOAD", { testedOn: "2026-11-20", passed: true }]]);
    const rows = dueRows([{ id: 1, kind: "GENERATOR" }, { id: 2, kind: "UPS", active: false }], last, "2026-11-27");
    expect(rows.map((r) => [r.test, r.state])).toEqual([["GEN_NO_LOAD", "never"], ["FUEL", "never"], ["GEN_LOAD", "ok"]]);
  });
  it("words intervals and titles", () => {
    expect(everyText(7)).toBe("Weekly");
    expect(everyText(91)).toBe("Every 3 months");
    expect(everyText(45)).toBe("Every 45 days");
    expect(failureTitle("FUEL", "DGH-GEN-1", ["Fuel at 20 %"])).toBe("Fuel level failed on DGH-GEN-1: Fuel at 20 %");
  });
});

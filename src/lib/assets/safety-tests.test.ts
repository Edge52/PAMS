import { describe, expect, it } from "vitest";
import { analyserProblem, appliedPartLeakageLimit, equipmentLeakageLimit, judge, nextTestDue, requiredChecks, testDueState } from "./safety-tests";

describe("electrical safety tests (wave 23)", () => {
  it("gives the leakage limits by class, method and applied part", () => {
    expect(equipmentLeakageLimit("I", "DIRECT")).toBe(500);
    expect(equipmentLeakageLimit("II", "DIFFERENTIAL")).toBe(100);
    expect(equipmentLeakageLimit("I", "ALTERNATIVE")).toBe(1000);
    expect(equipmentLeakageLimit("II", "ALTERNATIVE")).toBe(500);
    expect(equipmentLeakageLimit("INTERNAL", "DIRECT")).toBeNull();
    expect(appliedPartLeakageLimit("BF")).toBe(5000);
    expect(appliedPartLeakageLimit("CF")).toBe(50);
    expect(appliedPartLeakageLimit("B")).toBeNull();
  });
  it("asks for an earth reading on class I only", () => {
    expect(requiredChecks({ protectionClass: "I", appliedPart: "NONE", method: "DIRECT" }).earth).toBe(0.3);
    expect(requiredChecks({ protectionClass: "II", appliedPart: "CF", method: "DIRECT" })).toEqual({ earth: null, equipmentLeakage: 100, appliedPartLeakage: 50 });
  });
  it("passes a good class I, type CF device and fails one over a limit", () => {
    const good = { protectionClass: "I", appliedPart: "CF", method: "DIRECT", visualOk: true, functionalOk: true, earthResistanceOhm: 0.12, insulationMOhm: 50, equipmentLeakageUa: 180, appliedPartLeakageUa: 12 } as const;
    expect(judge(good)).toEqual({ result: "PASS", failures: [] });
    expect(judge({ ...good, appliedPartLeakageUa: 61 })).toEqual({ result: "FAIL", failures: ["Applied part leakage 61 µA is over 50 µA."] });
    expect(judge({ ...good, earthResistanceOhm: 0.3 }).result).toBe("PASS");
    expect(judge({ ...good, earthResistanceOhm: 0.31 }).result).toBe("FAIL");
  });
  it("fails a test with a required reading missing, or a failed inspection", () => {
    expect(judge({ protectionClass: "I", appliedPart: "NONE", method: "DIRECT", visualOk: true, functionalOk: true }).failures)
      .toEqual(["Protective earth resistance was not measured.", "Equipment leakage current was not measured."]);
    expect(judge({ protectionClass: "INTERNAL", appliedPart: "NONE", method: "DIRECT", visualOk: false, functionalOk: true })).toEqual({ result: "FAIL", failures: ["Visual inspection failed."] });
    expect(judge({ protectionClass: "INTERNAL", appliedPart: "NONE", method: "DIRECT", visualOk: true, functionalOk: true }).result).toBe("PASS");
  });
  it("refuses an analyser whose calibration has run out or is unknown", () => {
    expect(analyserProblem({ label: "ESA615", calibrationDue: "2026-12-31" }, "2026-11-14")).toBeNull();
    expect(analyserProblem({ label: "ESA615", calibrationDue: "2026-11-14" }, "2026-11-14")).toBeNull();
    expect(analyserProblem({ label: "ESA615", calibrationDue: "2026-11-13" }, "2026-11-14")).toContain("ran out on 2026-11-13");
    expect(analyserProblem({ label: "ESA615", calibrationDue: null }, "2026-11-14")).toContain("no calibration date");
  });
  it("works out the next test and how close it is", () => {
    expect(nextTestDue("2026-11-14", 6)).toBe("2027-05-14");
    expect(nextTestDue("2026-11-14", null)).toBe("2027-11-14");
    expect(testDueState("2026-11-13", "2026-11-14")).toBe("overdue");
    expect(testDueState("2026-12-10", "2026-11-14")).toBe("soon");
    expect(testDueState("2027-03-01", "2026-11-14")).toBe("ok");
    expect(testDueState(null, "2026-11-14")).toBe("never");
  });
});

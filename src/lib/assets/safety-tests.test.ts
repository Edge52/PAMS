import { describe, expect, it } from "vitest";
import { analyserProblem, appliedPartLeakageLimit, equipmentLeakageLimit, insulationLimit, judge, nextTestDue, requiredChecks, safetyGateWarning, specialKind, testDueState } from "./safety-tests";

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
    expect(nextTestDue("2026-08-31", 6)).toBe("2027-02-28"); // A17: clamped, not 3 Mar
    expect(nextTestDue("2028-02-29", 12)).toBe("2029-02-28");
    expect(testDueState("2026-11-13", "2026-11-14")).toBe("overdue");
    expect(testDueState("2026-12-10", "2026-11-14")).toBe("soon");
    expect(testDueState("2027-03-01", "2026-11-14")).toBe("ok");
    expect(testDueState(null, "2026-11-14")).toBe("never");
  });
});

describe("electrical safety refinements (wave 40, Rigel IEC 62353 guide)", () => {
  const base = { protectionClass: "I", appliedPart: "CF", method: "DIRECT", visualOk: true, functionalOk: true, earthResistanceOhm: 0.1, equipmentLeakageUa: 100, appliedPartLeakageUa: 10 } as const;
  it("gives insulation minimums by test path", () => {
    expect(insulationLimit("MAINS_PE", "I", "NONE")).toBe(2);
    expect(insulationLimit("MAINS_PE", "II", "NONE")).toBeNull();
    expect(insulationLimit("MAINS_ACCESSIBLE", "II", "NONE")).toBe(7);
    expect(insulationLimit("AP_PE", "I", "BF")).toBe(70);
    expect(insulationLimit("AP_MAINS", "I", "B")).toBe(2);
    expect(insulationLimit("AP_MAINS", "II", "B")).toBe(7);
    expect(insulationLimit("AP_MAINS", "II", "CF")).toBe(70);
    expect(insulationLimit("AP_MAINS", "INTERNAL", "CF")).toBeNull();
  });
  it("judges insulation readings by path, and the single reading by class", () => {
    expect(judge({ ...base, insulation: [{ path: "MAINS_PE", mohm: 3 }, { path: "AP_MAINS", mohm: 80 }] }).result).toBe("PASS");
    expect(judge({ ...base, insulation: [{ path: "AP_MAINS", mohm: 60 }] }).failures).toEqual(["Insulation applied parts to mains 60 MΩ is under 70 MΩ."]);
    expect(judge({ ...base, protectionClass: "II", earthResistanceOhm: null, equipmentLeakageUa: 50, insulationMOhm: 5 }).failures).toEqual(["Insulation resistance 5 MΩ is under 7 MΩ."]);
    expect(judge({ ...base, insulationMOhm: 5 }).result).toBe("PASS");
  });
  it("allows more leakage on mobile X-ray and 100 µA on defibrillator paddles", () => {
    expect(equipmentLeakageLimit("I", "DIRECT", true)).toBe(2000);
    expect(equipmentLeakageLimit("I", "ALTERNATIVE", true)).toBe(5000);
    expect(appliedPartLeakageLimit("CF", true)).toBe(100);
    expect(judge({ ...base, equipmentLeakageUa: 1500, mobileXray: true }).result).toBe("PASS");
    expect(judge({ ...base, equipmentLeakageUa: 1500 }).result).toBe("FAIL");
    expect(judge({ ...base, appliedPartLeakageUa: 80, defibPaddles: true }).result).toBe("PASS");
    expect(specialKind("IMG-XR-CARM")).toEqual({ mobileXray: true, defibPaddles: false });
    expect(specialKind("LIF-DEF-AED")).toEqual({ mobileXray: false, defibPaddles: true });
    expect(specialKind("IMG-XR-DR")).toEqual({ mobileXray: false, defibPaddles: false });
  });
  it("asks for a reason when there is no passed test at acceptance or after repair", () => {
    expect(safetyGateWarning({ context: "REPAIR", inProgramme: true, passedSince: false })).toContain("after every repair");
    expect(safetyGateWarning({ context: "ACCEPTANCE", inProgramme: true, passedSince: false })).toContain("before first use");
    expect(safetyGateWarning({ context: "REPAIR", inProgramme: true, passedSince: true })).toBeNull();
    expect(safetyGateWarning({ context: "REPAIR", inProgramme: false, passedSince: false })).toBeNull();
  });
});

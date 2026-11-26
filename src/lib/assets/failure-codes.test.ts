import { describe, expect, it } from "vitest";
import { FAILURE_CODE_NEEDED, FAILURE_CODES, failureCodeLabel, failureCodeProblem, failureCodeWarning, isFailureCode } from "./failure-codes";

describe("failure codes", () => {
  it("has a plain label for every code", () => {
    for (const c of FAILURE_CODES) expect(failureCodeLabel(c)).toMatch(/^[A-Z][a-z]/);
  });
  it("knows the list", () => {
    expect(isFailureCode("WEAR")).toBe(true);
    expect(isFailureCode("wear")).toBe(false);
    expect(failureCodeLabel(null)).toBeNull();
  });
  it("needs a code to complete a corrective job", () => {
    expect(failureCodeProblem("CORRECTIVE", null)).toBe(FAILURE_CODE_NEEDED);
    expect(failureCodeProblem("CORRECTIVE", "WEAR")).toBeNull();
    expect(failureCodeProblem("PPM", null)).toBeNull();
  });
  it("lets the offline sync leave it out but never send a wrong one", () => {
    expect(failureCodeProblem("CORRECTIVE", undefined, true)).toBeNull();
    expect(failureCodeProblem("CORRECTIVE", "BROKEN", true)).toMatch(/isn't on the list/);
  });
  it("warns, not blocks, on signing off an old job without a code", () => {
    expect(failureCodeWarning({ type: "CORRECTIVE", failureCode: null })).toMatch(/No failure code/);
    expect(failureCodeWarning({ type: "CORRECTIVE", failureCode: "OTHER" })).toBeNull();
    expect(failureCodeWarning({ type: "PPM", failureCode: null })).toBeNull();
  });
});

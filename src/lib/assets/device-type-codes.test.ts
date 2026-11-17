import { describe, expect, it } from "vitest";
import { cleanGmdnCode, gmdnCodeProblem } from "./device-type-codes";

describe("GMDN code (wave 27)", () => {
  it("accepts 5 digits, with or without spaces, and an empty code", () => {
    expect(gmdnCodeProblem("37647")).toBeNull();
    expect(gmdnCodeProblem(" 376 47 ")).toBeNull();
    expect(cleanGmdnCode(" 376 47 ")).toBe("37647");
    expect(gmdnCodeProblem("")).toBeNull();
    expect(gmdnCodeProblem(null)).toBeNull();
    expect(cleanGmdnCode("  ")).toBeNull();
  });
  it("refuses anything else", () => {
    for (const bad of ["3764", "376470", "3764a", "GMDN 37647", "37-647"]) expect(gmdnCodeProblem(bad)).toMatch(/5 digits/);
  });
});

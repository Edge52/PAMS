import { describe, expect, it } from "vitest";
import { cleanTag, parseTags } from "./tags";

describe("asset tags", () => {
  it("cleans and splits", () => {
    expect(parseTags("Loan, teaching;  Donated\nloan")).toEqual(["loan", "teaching", "donated"]);
    expect(cleanTag("  Ward-3 / ICU!! ")).toBe("ward-3 icu");
    expect(cleanTag("   ")).toBeNull();
    expect(parseTags("تبرع, x")).toEqual(["تبرع", "x"]);
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(","))).toHaveLength(10);
  });
});

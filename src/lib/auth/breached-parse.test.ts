import { describe, expect, it } from "vitest";
import { breachCount } from "./breached-parse";

describe("breached-password answer (wave 29)", () => {
  const body = "0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\nFFFFF0000000000000000000000000000000:0\r\n";
  it("finds the count for our suffix, in any case", () => {
    expect(breachCount(body, "1e4c9b93f3f0682250b6cf8331b7ee68fd8")).toBe(3861493);
  });
  it("is 0 when absent or a padding line", () => {
    expect(breachCount(body, "AAAAA0000000000000000000000000000000")).toBe(0);
    expect(breachCount(body, "FFFFF0000000000000000000000000000000")).toBe(0);
    expect(breachCount("", "X")).toBe(0);
  });
});

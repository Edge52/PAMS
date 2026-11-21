import { describe, expect, it } from "vitest";
import { bandPrice } from "./pricing";

describe("BOQ catalogue estimate (DL-05)", () => {
  it("converts the USD band price at the rate", () => {
    expect(bandPrice(1000, 48.5)).toEqual({ price: "48500.00", noRate: false });
  });
  it("never stores the USD figure as local currency when there is no rate", () => {
    // Before the fix this returned "1000.00" for an EGP BOQ: totals about 50 times too low.
    expect(bandPrice(1000, null)).toEqual({ price: null, noRate: true });
  });
  it("no band, no price", () => {
    expect(bandPrice(null, 48.5)).toEqual({ price: null, noRate: false });
  });
});

import { describe, expect, it } from "vitest";
import { bondCover } from "./bond-cover";

describe("bondCover (DL-07)", () => {
  it("converts bonds to the required currency before comparing", () => {
    // 1,500 USD required. A 50,000 EGP bond (at 0.02 USD) is 1,000 USD: short, although 50,000 > 1,500.
    const c = bondCover([{ amount: 50000, currency: "EGP" }], 1500, "USD", { EGP: 0.02 });
    expect(c.total).toBe(1000);
    expect(c.short).toBe(true);
    expect(c.converted).toBe(true);
  });

  it("adds up bonds in several currencies", () => {
    const c = bondCover([{ amount: 1000, currency: "USD" }, { amount: 30000, currency: "EGP" }], 1500, "USD", { EGP: 0.02 });
    expect(c.total).toBe(1600);
    expect(c.short).toBe(false);
  });

  it("doesn't check when a bond's currency has no rate", () => {
    const c = bondCover([{ amount: 100, currency: "EUR" }, { amount: 2000, currency: "USD" }], 1500, "USD", {});
    expect(c.missing).toEqual(["EUR"]);
    expect(c.short).toBeNull();
    expect(c.total).toBe(2000);
  });

  it("compares as before in one currency, and not at all when nothing is required", () => {
    expect(bondCover([{ amount: 1499.99, currency: "EGP" }], 1500, "EGP", {}).short).toBe(true);
    expect(bondCover([{ amount: 1500, currency: "EGP" }], 1500, "EGP", {}).short).toBe(false);
    expect(bondCover([{ amount: 1, currency: "EGP" }], null, "EGP", {}).short).toBeNull();
  });
});

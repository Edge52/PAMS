import { describe, expect, it } from "vitest";
import { HIDDEN_PRICE, seesPrices, shownMoney } from "./prices";

describe("who sees supplier prices (audit R9)", () => {
  it("those who buy, approve and pay", () => {
    for (const r of ["ADMIN", "DIRECTOR", "PROCUREMENT", "FINANCE"]) expect(seesPrices(r)).toBe(true);
  });
  it("not department heads, viewers or the technical roles", () => {
    for (const r of ["DEPARTMENT_HEAD", "VIEWER", "PLANNER", "BIOMEDICAL", "TECHNICIAN", null]) expect(seesPrices(r)).toBe(false);
  });
  it("hides the amount, not just the currency", () => {
    expect(shownMoney(false, 1234.5, "USD")).toBe(HIDDEN_PRICE);
    expect(shownMoney(true, 1234.5, "USD")).toContain("1,234");
  });
});

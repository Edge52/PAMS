import { describe, expect, it } from "vitest";
import { FxTable, parseRateInput } from "./fx";

const fx = new FxTable([
  { currency: "USD", rateToEgp: 48.5, effectiveDate: "2026-10-01" },
  { currency: "USD", rateToEgp: 50.25, effectiveDate: "2026-11-15" },
  { currency: "EUR", rateToEgp: 52.8, effectiveDate: "2026-10-01" },
]);

describe("rate on a date (B2, DL-18)", () => {
  it("uses the latest rate on or before the date", () => {
    expect(fx.rateOn("USD", "2026-11-14")?.rate).toBe(48.5);
    expect(fx.rateOn("USD", "2026-11-15")?.rate).toBe(50.25);
    expect(fx.rateOn("USD", "2027-01-01")?.rate).toBe(50.25);
  });
  it("gives the first rate, marked early, for dates before any rate", () => {
    expect(fx.rateOn("USD", "2025-03-01")).toEqual({ rate: 48.5, date: "2026-10-01", early: true });
  });
  it("EGP is 1; an unknown currency has no rate", () => {
    expect(fx.rateOn("EGP", "2026-01-01")?.rate).toBe(1);
    expect(fx.rateOn(null, "2026-01-01")?.rate).toBe(1);
    expect(fx.rateOn("CNY", "2026-11-01")).toBeNull();
    expect(fx.toEgp(100, "CNY", "2026-11-01")).toBeNull();
  });
  it("a closed tender keeps its ranking when the rate moves later", () => {
    const opening = "2026-11-01";
    expect(fx.convert(1000, "USD", "EGP", opening)).toBe(48_500);
    expect(fx.convert(1000, "EUR", "USD", opening)).toBeCloseTo(1088.66, 2);
  });
});

describe("dated sum (DL-18)", () => {
  it("converts each amount at the rate of its own date and lists currencies with no rate", () => {
    expect(fx.sum([
      { amount: 100, currency: "USD", date: "2026-10-10" }, // 48.5
      { amount: 100, currency: "USD", date: "2026-11-20" }, // 50.25
      { amount: 500, currency: "EGP", date: "2026-11-20" },
      { amount: 10, currency: "CNY", date: "2026-11-20" },
    ])).toEqual({ egp: 4850 + 5025 + 500, missing: ["CNY"] });
  });
});

describe("latest rates", () => {
  it("flags rates older than a month", () => {
    const l = fx.latest("2026-11-21");
    expect(l.find((r) => r.currency === "USD")).toMatchObject({ rate: 50.25, ageDays: 6, stale: false });
    expect(l.find((r) => r.currency === "EUR")).toMatchObject({ ageDays: 51, stale: true });
  });
});

describe("register input", () => {
  const today = "2026-11-21";
  it("accepts a normal rate", () => {
    expect(parseRateInput({ currency: "usd", rate: "48.65", date: "2026-11-20" }, today)).toEqual({ ok: true, currency: "USD", rate: 48.65, date: "2026-11-20" });
  });
  it("rejects EGP, zero, junk and future dates", () => {
    expect(parseRateInput({ currency: "EGP", rate: "1", date: today }, today)).toMatchObject({ ok: false, field: "currency" });
    expect(parseRateInput({ currency: "USD", rate: "0", date: today }, today)).toMatchObject({ ok: false, field: "rate" });
    expect(parseRateInput({ currency: "USD", rate: "abc", date: today }, today)).toMatchObject({ ok: false, field: "rate" });
    expect(parseRateInput({ currency: "USD", rate: "48", date: "2026-12-01" }, today)).toMatchObject({ ok: false, field: "date" });
  });
});

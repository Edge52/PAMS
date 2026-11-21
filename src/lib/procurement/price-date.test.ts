import { describe, expect, it } from "vitest";
import { tenderPriceDate } from "./price-date";

const local = (d: Date) => d.toISOString().slice(0, 10);
const today = "2026-11-21";
const base = { twoEnvelope: false, technicalOpenedAt: null, financialOpenedAt: null };

describe("tender price date (B2)", () => {
  it("two-envelope: the financial opening, not the technical one", () => {
    expect(tenderPriceDate({ ...base, twoEnvelope: true, technicalOpenedAt: new Date("2026-10-05T09:00Z"), financialOpenedAt: new Date("2026-10-20T09:00Z") }, today, local))
      .toMatchObject({ date: "2026-10-20", fixed: true });
  });
  it("two-envelope still sealed: falls back to the RFQ closing date, then today", () => {
    const p = { ...base, twoEnvelope: true, technicalOpenedAt: new Date("2026-10-05T09:00Z") };
    expect(tenderPriceDate({ ...p, rfqClosingDate: "2026-10-01" }, today, local)).toMatchObject({ date: "2026-10-01", fixed: true });
    expect(tenderPriceDate(p, today, local)).toMatchObject({ date: today, fixed: false });
  });
  it("single envelope: the opening day", () => {
    expect(tenderPriceDate({ ...base, technicalOpenedAt: new Date("2026-10-05T09:00Z") }, today, local).date).toBe("2026-10-05");
  });
  it("an RFQ closing in the future doesn't fix the date", () => {
    expect(tenderPriceDate({ ...base, rfqClosingDate: "2026-12-01" }, today, local)).toMatchObject({ date: today, fixed: false });
  });
});

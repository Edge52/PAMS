import { describe, expect, it } from "vitest";
import { checkState, loanProblems, loanState, overdueLoanAlerts, registerSuggestion } from "./loans";

const today = "2026-11-17";

describe("loans", () => {
  it("is open, overdue or returned", () => {
    expect(loanState({ dueBackOn: "2026-11-20" }, today)).toBe("OPEN");
    expect(loanState({ dueBackOn: null }, today)).toBe("OPEN");
    expect(loanState({ dueBackOn: "2026-11-16" }, today)).toBe("OVERDUE");
    expect(loanState({ dueBackOn: "2026-11-16", returnedOn: "2026-11-17" }, today)).toBe("RETURNED");
  });
  it("needs a check before use only for borrowed devices", () => {
    expect(checkState({ direction: "LENT" })).toBe("NOT_NEEDED");
    expect(checkState({ direction: "BORROWED" })).toBe("NOT_CHECKED");
    expect(checkState({ direction: "BORROWED", checkedOn: today, checkPpmOk: true, checkSafetyOk: true })).toBe("FIT");
    expect(checkState({ direction: "BORROWED", checkedOn: today, checkPpmOk: true, checkSafetyOk: false })).toBe("NOT_FIT");
  });
  it("checks the form", () => {
    expect(loanProblems({ direction: "BORROWED", otherParty: "Supplier", deviceDescription: "Infusion pump", outOn: "2026-11-01", dueBackOn: "2026-11-30" }, today)).toEqual({});
    expect(loanProblems({ direction: "LENT", otherParty: "Hospital B", outOn: "2026-11-01" }, today)).toHaveProperty("assetTag");
    expect(loanProblems({ direction: "BORROWED", otherParty: " ", outOn: "2026-11-01" }, today)).toMatchObject({ otherParty: expect.any(String), deviceDescription: expect.any(String) });
    expect(loanProblems({ direction: "BORROWED", otherParty: "X", assetId: 4, outOn: "2026-11-10", dueBackOn: "2026-11-09", returnedOn: "2026-11-09" }, today)).toMatchObject({ dueBackOn: expect.any(String), returnedOn: expect.any(String) });
    expect(loanProblems({ direction: "BORROWED", otherParty: "X", assetId: 4, outOn: "2026-12-01" }, today)).toHaveProperty("outOn");
  });
  it("reads the register for a borrowed device that is in it", () => {
    expect(registerSuggestion({ ppmDue: "2026-12-01", safetyNextDue: "2026-11-01" }, today)).toEqual({ ppmOk: true, safetyOk: false });
    expect(registerSuggestion({ safetyFailed: true, safetyNextDue: "2027-01-01" }, today)).toEqual({ ppmOk: null, safetyOk: false });
  });
  it("tells about an overdue loan once", () => {
    const a = overdueLoanAlerts([
      { id: 3, number: "LN-2026-0003", facilityId: 1, direction: "BORROWED", otherParty: "MedServe", device: "Syringe pump", dueBackOn: "2026-11-10", returnedOn: null },
      { id: 4, number: "LN-2026-0004", facilityId: 1, direction: "LENT", otherParty: "Hospital B", device: "Monitor", dueBackOn: "2026-12-10", returnedOn: null },
    ], today);
    expect(a).toHaveLength(1);
    expect(a[0].n).toMatchObject({ kind: "loan_overdue", dedupeKey: "loan_overdue:3", href: "/assets/loans/3" });
  });
});

import { describe, expect, it } from "vitest";
import { addMonthsISO, todayISO } from "./format";

describe("todayISO (hospital time zone)", () => {
  it("uses Cairo, not UTC: 23:30 UTC on 27 Oct is already 28 Oct in Cairo", () => {
    expect(todayISO(new Date("2026-10-27T23:30:00Z"))).toBe("2026-10-28");
    expect(todayISO(new Date("2026-10-27T12:00:00Z"))).toBe("2026-10-27");
  });
});

describe("addMonthsISO", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonthsISO("2026-08-31", 6)).toBe("2027-02-28");
    expect(addMonthsISO("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsISO("2026-01-31", 1)).toBe("2026-02-28");
  });
  it("keeps the day when it exists", () => {
    expect(addMonthsISO("2026-10-15", 36)).toBe("2029-10-15");
    expect(addMonthsISO("2026-12-31", 12)).toBe("2027-12-31");
  });
});

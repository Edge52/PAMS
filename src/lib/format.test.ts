import { describe, expect, it } from "vitest";
import { addMonthsISO, formatMoney, todayISO } from "./format";

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

describe("Cairo dates (CO-09)", () => {
  it("today is the Cairo date, not the UTC one, just after midnight", async () => {
    const { todayISO } = await import("./format");
    // 00:30 on 21 Nov in Cairo is still 20 Nov in UTC.
    expect(todayISO(new Date("2026-11-20T22:30:00Z"))).toBe("2026-11-21");
  });
  it("a Cairo date and time becomes the right instant", async () => {
    const { zonedInstant } = await import("./format");
    expect(zonedInstant("2026-11-21", "01:30").toISOString()).toBe("2026-11-20T23:30:00.000Z"); // winter, UTC+2
    expect(zonedInstant("2026-07-15", "12:00").toISOString()).toBe("2026-07-15T09:00:00.000Z"); // summer time, UTC+3
  });
});

describe("formatMoney", () => {
  it("defaults to Egyptian pounds (wave 39)", () => {
    expect(formatMoney(1234.5).replace(/\s/g, " ")).toBe("EGP 1,234.50");
    expect(formatMoney("10", "USD")).toBe("$10.00");
    expect(formatMoney(null)).toBe("—");
  });
});

import { describe, expect, it } from "vitest";
import { addWorkingDays, holidaysOf, isWeekend, isWorkingDay, nextWorkingDay, workingDaysBetween } from "./working-days";

describe("working days (Friday and Saturday off, plus the hospital's holidays)", () => {
  it("knows the weekend", () => {
    expect(isWeekend("2026-11-27")).toBe(true); // Friday
    expect(isWeekend("2026-11-28")).toBe(true); // Saturday
    expect(isWeekend("2026-11-29")).toBe(false); // Sunday
    expect(isWorkingDay("2026-11-26")).toBe(true); // Thursday
    expect(isWorkingDay("2026-11-27")).toBe(false);
  });
  it("skips holidays, as a list or a set", () => {
    expect(isWorkingDay("2026-10-06", ["2026-10-06"])).toBe(false); // Tuesday holiday
    expect(isWorkingDay("2026-10-06", new Set(["2026-10-06"]))).toBe(false);
    expect(isWorkingDay("2026-10-07", new Set(["2026-10-06"]))).toBe(true);
  });
  it("counts working days after the start, the end included", () => {
    expect(workingDaysBetween("2026-11-26", "2026-11-26")).toBe(0);
    expect(workingDaysBetween("2026-11-26", "2026-11-28")).toBe(0); // Thu → Sat
    expect(workingDaysBetween("2026-11-26", "2026-11-29")).toBe(1); // → Sun
    expect(workingDaysBetween("2026-11-26", "2026-12-03")).toBe(5); // a full week
    expect(workingDaysBetween("2026-11-26", "2026-12-03", ["2026-11-30", "2026-11-28"])).toBe(4); // a weekend holiday counts once
    expect(workingDaysBetween("2026-12-01", "2026-11-26")).toBe(0);
  });
  it("adds working days over a weekend and a holiday", () => {
    expect(addWorkingDays("2026-11-26", 0)).toBe("2026-11-26");
    expect(addWorkingDays("2026-11-26", 1)).toBe("2026-11-29");
    expect(addWorkingDays("2026-11-26", 1, ["2026-11-29"])).toBe("2026-11-30");
    // 10 working days from Thursday 26 Nov with Monday 30 Nov off: 29, 1, 2, 3, 6, 7, 8, 9, 10, 13 Dec.
    expect(addWorkingDays("2026-11-26", 10, ["2026-11-30"])).toBe("2026-12-13");
  });
  it("finds the next working day", () => {
    expect(nextWorkingDay("2026-11-26")).toBe("2026-11-26");
    expect(nextWorkingDay("2026-11-27")).toBe("2026-11-29");
    expect(nextWorkingDay("2026-11-27", ["2026-11-29"])).toBe("2026-11-30");
  });
  it("takes group-wide holidays and the hospital's own", () => {
    const rows = [{ day: "2026-10-06", facilityId: null }, { day: "2026-11-01", facilityId: 1 }, { day: "2026-11-02", facilityId: 2 }];
    expect([...holidaysOf(rows, 1)].sort()).toEqual(["2026-10-06", "2026-11-01"]);
    expect([...holidaysOf(rows, null)]).toEqual(["2026-10-06"]);
  });
});

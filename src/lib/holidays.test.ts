import { describe, expect, it } from "vitest";
import { checkHolidayRow, copyFixedHolidays, type HolidayInput } from "./holidays";

const H = [{ id: 1, code: "DGH", name: "Demo General Hospital" }, { id: 2, code: "LPH", name: "La Plaza" }];

describe("holiday import rows", () => {
  it("reads a group-wide row and a hospital row", () => {
    expect(checkHolidayRow({ day: "2027-01-07", name: "Coptic Christmas" }, H, true)).toEqual({ value: { day: "2027-01-07", name: "Coptic Christmas", facilityId: null, moves: false }, errors: [] });
    expect(checkHolidayRow({ day: "07/01/2027", name: "X", hospital: "la plaza", moves: "yes" }, H, true).value).toEqual({ day: "2027-01-07", name: "X", facilityId: 2, moves: true });
    expect(checkHolidayRow({ day: "2027-01-07", name: "X", hospital: "lph" }, H, false).value?.facilityId).toBe(2);
  });
  it("says what is wrong", () => {
    expect(checkHolidayRow({ day: "soon", name: "" }, H, true).errors).toHaveLength(2);
    expect(checkHolidayRow({ day: "2027-01-07", name: "X", hospital: "Other" }, H, true).errors[0]).toMatch(/No hospital/);
    expect(checkHolidayRow({ day: "2027-01-07", name: "X" }, H, false).errors[0]).toMatch(/Name the hospital/);
  });
});

describe("copy last year's fixed-date holidays", () => {
  const rows: HolidayInput[] = [
    { day: "2026-01-07", name: "Coptic Christmas", facilityId: null, moves: false },
    { day: "2026-03-20", name: "Eid al-Fitr", facilityId: null, moves: true },
    { day: "2026-07-23", name: "Revolution Day", facilityId: null, moves: false },
    { day: "2027-07-23", name: "Revolution Day", facilityId: null, moves: false },
    { day: "2026-05-05", name: "Hospital day", facilityId: 2, moves: false },
    { day: "2025-10-06", name: "Armed Forces Day", facilityId: null, moves: false },
  ];
  it("copies fixed dates one year on, leaving moving ones, other years and dates already there", () => {
    expect(copyFixedHolidays(rows, 2026).map((r) => [r.day, r.facilityId])).toEqual([["2027-01-07", null], ["2027-05-05", 2]]);
  });
  it("leaves out 29 February", () => {
    expect(copyFixedHolidays([{ day: "2028-02-29", name: "Leap", facilityId: null, moves: false }], 2028)).toEqual([]);
  });
});

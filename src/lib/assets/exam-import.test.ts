import { describe, expect, it } from "vitest";
import { cleanAeTitle, deviceDays, mapExamHeaders, monthTotals, parseCsv, utilisation, validateExamRows, type ExamLookups } from "./exam-import";

const ct = { assetId: 1, tag: "LPH-IMG-000400", facilityId: 2 }, mr = { assetId: 2, tag: "LPH-IMG-000401", facilityId: 2 };
const lk: ExamLookups = { byTag: new Map([[ct.tag, ct], [mr.tag, mr]]), byAe: new Map([["CT_ROOM1", ct]]) };

describe("exam count import", () => {
  it("reads CSV with quotes, semicolons and a BOM", () => {
    expect(parseCsv('﻿AE Title,Study date,Exams\r\nCT_ROOM1,"2026-11-01",42\n\n')).toEqual([["AE Title", "Study date", "Exams"], ["CT_ROOM1", "2026-11-01", "42"]]);
    expect(parseCsv('a;b\n"x;""y""";2')).toEqual([["a", "b"], ['x;"y"', "2"]]);
  });

  it("maps loose headers", () => {
    expect(mapExamHeaders(["Station AE Title", "Study Date", "Exam count", "Modality", "Study description"]).map).toEqual(
      new Map([["device", 0], ["date", 1], ["exams", 2], ["modality", 3], ["procedure", 4]]));
    expect(mapExamHeaders(["Date", "Exams"]).missing).toEqual(["device tag or AE title"]);
  });

  it("checks rows, resolves AE titles and adds up same-day rows", () => {
    const { map } = mapExamHeaders(["device", "date", "exams", "procedure"]);
    const raw = [
      ["ct_room1", "01/11/2026", "20", "Head"], ["CT_ROOM1", "2026-11-01", 5, "head"], ["LPH-IMG-000400", "2026-11-01", "7", "Chest"],
      ["UNKNOWN", "2026-11-01", "3", ""], ["LPH-IMG-000401", "2026-13-01", "3", ""], ["LPH-IMG-000401", "2026-11-02", "-1", ""], ["LPH-IMG-000401", "2026-12-01", "4", ""],
      ["LPH-IMG-000401", 46327, "1,200", ""],
    ].map((cells, i) => ({ rowNumber: i + 2, cells }));
    const { rows, valid } = validateExamRows(raw, map, lk, "2026-11-20");
    expect(rows.map((r) => r.errors.length)).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
    expect(rows[3].errors[0]).toMatch(/not a device tag or AE title/);
    expect(rows[6].errors[0]).toMatch(/future/);
    expect(valid).toEqual([
      { assetId: 1, tag: ct.tag, day: "2026-11-01", procedure: "Head", modality: null, exams: 25 },
      { assetId: 1, tag: ct.tag, day: "2026-11-01", procedure: "Chest", modality: null, exams: 7 },
      { assetId: 2, tag: mr.tag, day: "2026-11-01", procedure: "", modality: null, exams: 1200 },
    ]);
    expect(deviceDays(valid)).toEqual(["1|2026-11-01", "2|2026-11-01"]);
  });

  it("totals months and works out use per day and week", () => {
    const days = [{ day: "2026-10-30", exams: 10 }, { day: "2026-11-01", exams: 30 }, { day: "2026-11-19", exams: 40 }, { day: "2026-11-20", exams: 50 }];
    expect(monthTotals(days)).toEqual(new Map([["2026-10-01", 10], ["2026-11-01", 120]]));
    const u = utilisation(days, "2026-11-20", 28, 4);
    expect(u.total).toBe(130);
    expect(u.perDay).toBeCloseTo(130 / 28, 6);
    expect(u.perWeek).toBeCloseTo(32.5, 6);
    expect(u.busiest).toEqual({ day: "2026-11-20", exams: 50 });
    expect(u.weekly.map((w) => w.exams)).toEqual([10, 30, 0, 90]);
    expect(u.lastDay).toBe("2026-11-20");
  });

  it("cleans AE titles", () => {
    expect(cleanAeTitle(" ct_room1 ")).toBe("CT_ROOM1");
    expect(cleanAeTitle("A".repeat(17))).toBeNull();
    expect(cleanAeTitle("A\\B")).toBeNull();
  });
});

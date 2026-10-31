import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  addOutcome, awardStage, classifyPpm, compliancePct, complianceTone, daysLate, emptyTally, facilityFilter, filtersToQuery,
  leastAdvanced, parseReportFilters, sumKey, sumTallies, sumToEgp, toEgp,
} from "./calc";
import { excelCell, exportFileName, reportWorkbook, sheetName } from "./excel";

const today = "2026-10-29";

describe("days late", () => {
  it("counts whole days after the expected date", () => {
    expect(daysLate("2026-10-19", today)).toBe(10);
    expect(daysLate("2026-10-28", today)).toBe(1);
  });
  it("is 0 on or before the expected date, null without one or once delivered", () => {
    expect(daysLate(today, today)).toBe(0);
    expect(daysLate("2026-12-01", today)).toBe(0);
    expect(daysLate(null, today)).toBeNull();
    expect(daysLate("2026-10-01", today, true)).toBeNull();
  });
});

describe("EGP totals", () => {
  const rates = new Map<string, number | null>([["USD", 48.5], ["EUR", 52], ["EGP", 1], ["CNY", null]]);
  it("converts and sums several currencies", () => {
    const r = sumToEgp([{ amount: 100, currency: "USD" }, { amount: 10, currency: "EUR" }, { amount: 1000, currency: "EGP" }], rates);
    expect(r.egp).toBe(4850 + 520 + 1000);
    expect(r.missing).toEqual([]);
    expect(r.byCurrency).toEqual({ USD: 100, EUR: 10, EGP: 1000 });
  });
  it("leaves out and reports currencies without a rate", () => {
    const r = sumToEgp([{ amount: 100, currency: "USD" }, { amount: 5, currency: "CNY" }, { amount: 7, currency: "GBP" }], rates);
    expect(r.egp).toBe(4850);
    expect(r.missing).toEqual(["CNY", "GBP"]);
  });
  it("treats EGP as rate 1 even when absent and rounds to cents", () => {
    expect(sumToEgp([{ amount: 0.1, currency: "EGP" }, { amount: 0.2, currency: "EGP" }], {}).egp).toBe(0.3);
    expect(toEgp(2.5, "USD", rates)).toBe(121.25);
    expect(toEgp(2.5, "CNY", rates)).toBeNull();
    expect(toEgp(2.5, null, rates)).toBe(2.5);
  });
  it("sums numeric row keys", () => {
    expect(sumKey([{ a: 1.1 }, { a: 2.2 }, { a: null }, { a: "x" }], "a")).toBe(3.3);
  });
});

describe("PPM compliance", () => {
  it("classifies against scheduled date + grace", () => {
    expect(classifyPpm({ status: "COMPLETED", scheduledDate: "2026-10-01", completedDate: "2026-10-01" }, today, 0)).toBe("ON_TIME");
    expect(classifyPpm({ status: "COMPLETED", scheduledDate: "2026-10-01", completedDate: "2026-10-02" }, today, 0)).toBe("LATE");
    expect(classifyPpm({ status: "COMPLETED", scheduledDate: "2026-10-01", completedDate: "2026-10-08" }, today, 7)).toBe("ON_TIME");
    expect(classifyPpm({ status: "COMPLETED", scheduledDate: "2026-10-01", completedDate: "2026-10-09" }, today, 7)).toBe("LATE");
    expect(classifyPpm({ status: "SCHEDULED", scheduledDate: "2026-10-28" }, today, 0)).toBe("OVERDUE");
    expect(classifyPpm({ status: "SCHEDULED", scheduledDate: "2026-10-28" }, today, 7)).toBe("PENDING");
    expect(classifyPpm({ status: "IN_PROGRESS", scheduledDate: "2026-11-15" }, today, 0)).toBe("PENDING");
    expect(classifyPpm({ status: "CANCELLED", scheduledDate: "2026-10-01" }, today, 0)).toBe("CANCELLED");
  });
  it("computes compliance over what should be done by now", () => {
    const t = emptyTally();
    for (const o of ["ON_TIME", "ON_TIME", "ON_TIME", "LATE", "OVERDUE", "PENDING", "CANCELLED"] as const) addOutcome(t, o);
    expect(t).toMatchObject({ due: 6, onTime: 3, late: 1, overdue: 1, pending: 1 });
    expect(compliancePct(t)).toBe(60); // 3 / (3 + 1 + 1)
    expect(compliancePct({ ...t, unscheduled: 1 })).toBe(50); // never-scheduled PPMs count against compliance
    expect(compliancePct({ onTime: 2, late: 1, overdue: 0, unscheduled: 0 })).toBe(66.7);
    expect(compliancePct(emptyTally())).toBeNull();
  });
  it("adds tallies and colours compliance", () => {
    const s = sumTallies([{ ...emptyTally(), due: 2, onTime: 2 }, { ...emptyTally(), due: 3, overdue: 1, unscheduled: 2 }]);
    expect(s).toEqual({ due: 5, onTime: 2, late: 0, overdue: 1, pending: 0, unscheduled: 2 });
    expect(complianceTone(95)).toBe("ok");
    expect(complianceTone(75)).toBe("warn");
    expect(complianceTone(40)).toBe("danger");
    expect(complianceTone(null)).toBeNull();
  });
});

describe("award stage", () => {
  const aw = { status: "AWARDED", complaintUntil: "2026-11-02", acceptedOn: null };
  it("follows approval → complaint window → acceptance", () => {
    expect(awardStage(null, today)).toBe("NONE");
    expect(awardStage({ ...aw, status: "SHORTLISTED" }, today)).toBe("NONE");
    expect(awardStage({ ...aw, complaintUntil: null }, today)).toBe("AWARDED");
    expect(awardStage(aw, today)).toBe("COMPLAINT_WINDOW");
    expect(awardStage({ ...aw, complaintUntil: today }, today)).toBe("COMPLAINT_WINDOW");
    expect(awardStage({ ...aw, complaintUntil: "2026-10-28" }, today)).toBe("ACCEPTANCE_DUE");
    expect(awardStage({ ...aw, acceptedOn: "2026-10-29" }, today)).toBe("ACCEPTED");
    expect(leastAdvanced(["ACCEPTED", "COMPLAINT_WINDOW", "NONE"])).toBe("COMPLAINT_WINDOW");
    expect(leastAdvanced(["NONE"])).toBe("NONE");
  });
});

describe("filters", () => {
  it("parses and falls back to defaults", () => {
    const f = parseReportFilters(new URLSearchParams("facilityId=2&from=2026-01-01&to=2026-03-31&days=60&grace=0&status=all"));
    expect(f).toEqual({ facilityId: 2, from: "2026-01-01", to: "2026-03-31", days: 60, grace: 0, projectStatus: "all" });
    const d = parseReportFilters({ facilityId: "x", from: "2026-02-30", days: "-1", grace: "abc" }, { from: "2026-01-01", grace: 7, days: 90 });
    expect(d).toEqual({ facilityId: null, from: "2026-01-01", to: null, days: 90, grace: 7, projectStatus: "open" });
  });
  it("swaps a reversed range and round-trips the query", () => {
    const f = parseReportFilters({ from: "2026-05-01", to: "2026-01-01" });
    expect([f.from, f.to]).toEqual(["2026-01-01", "2026-05-01"]);
    expect(filtersToQuery({ ...f, facilityId: 3 }, ["facility", "dateRange"])).toBe("?facilityId=3&from=2026-01-01&to=2026-05-01");
    expect(filtersToQuery(f, [])).toBe("");
  });
  it("respects the user's facility scope", () => {
    expect(facilityFilter(null, null)).toBeNull();
    expect(facilityFilter(2, null)).toEqual([2]);
    expect(facilityFilter(null, [1, 3])).toEqual([1, 3]);
    expect(facilityFilter(3, [1, 3])).toEqual([3]);
    expect(facilityFilter(2, [1, 3])).toBe("forbidden");
  });
});

describe("Excel export", () => {
  it("types cells with number and date formats", () => {
    expect(excelCell({ key: "d", header: "D", type: "date" }, { d: "2026-10-29" })).toEqual({ value: new Date("2026-10-29T00:00:00Z"), numFmt: "dd mmm yyyy" });
    expect(excelCell({ key: "p", header: "P", type: "pct" }, { p: 62.5 })).toEqual({ value: 0.625, numFmt: "0.0%" });
    expect(excelCell({ key: "m", header: "M", type: "money", currencyKey: "c" }, { m: 10, c: "USD" }).numFmt).toContain('"USD"');
    expect(excelCell({ key: "x", header: "X" }, { x: null })).toEqual({ value: null });
  });
  it("makes valid, unique sheet names and safe file names", () => {
    const used = new Set<string>();
    expect(sheetName("By department / status [x]", used)).toBe("By department   status  x");
    expect(sheetName("A very long sheet title that will not fit at all", used)).toHaveLength(31);
    expect(sheetName("A very long sheet title that will not fit at all", used)).toMatch(/\(2\)$/);
    expect(exportFileName("ppm-compliance", today)).toBe("ppm-compliance-2026-10-29.xlsx");
  });
  it("writes a workbook with header, rows, totals and widths", async () => {
    const buf = await reportWorkbook("Open purchase orders", {
      sections: [{
        key: "po", columns: [
          { key: "n", header: "PO", width: 16 }, { key: "d", header: "Expected", type: "date", width: 14 },
          { key: "v", header: "Value (EGP)", type: "egp", width: 18 }, { key: "s", header: "Screen only", only: "screen" },
        ],
        rows: [{ n: "PO-1", d: "2026-10-01", v: 1500.5 }, { n: "PO-2", d: null, v: 20 }],
        totals: { n: "2 orders", v: 1520.5 }, empty: "None",
      }],
      notes: ["A note"],
    }, ["Facility: all"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Open purchase orders");
    expect(ws.getColumn(1).width).toBe(16);
    expect(ws.getRow(4).values).toEqual([undefined, "PO", "Expected", "Value (EGP)"]);
    expect(ws.getRow(5).getCell(3).value).toBe(1500.5);
    expect(ws.getRow(5).getCell(3).numFmt).toContain("EGP");
    expect(ws.getRow(5).getCell(2).value).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(ws.getRow(7).getCell(1).value).toBe("2 orders");
    expect(ws.getRow(7).font?.bold).toBe(true);
  });
});

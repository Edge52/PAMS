import { describe, expect, it } from "vitest";
import { ratesFor, tcoLine, tcoSummary } from "./tco";
import { checkRooms, needFor } from "./room-requirements";
import { cashFlow, cleanPhaseMonths, leadMonths } from "./phasing";

describe("cost of ownership", () => {
  it("uses the most specific rates and the device type's own life", () => {
    expect(ratesFor("IMG-CT-64").label).toBe("CT");
    expect(ratesFor("IMG-US-GEN").label).toBe("Imaging");
    expect(ratesFor("XYZ").label).toBe("Other");
    expect(ratesFor("IMG-CT-64", 12).life).toBe(12);
  });
  it("adds running costs and replacements inside the horizon", () => {
    const r = tcoLine({ code: "IMG-CT-64", name: "CT", quantity: 1, unitPrice: 1000 }, 10); // life 8 → one replacement in 10 years
    expect(r).toMatchObject({ purchase: 1000, replacements: 1000 });
    expect(r.running).toBeCloseTo(1000 * 0.14 * 10);
    expect(tcoLine({ code: "IMG-CT-64", name: "CT", quantity: 1, unitPrice: 1000 }, 5).replacements).toBe(0);
    const s = tcoSummary([{ code: "THR-HD-MCH", name: "Dialysis", quantity: 2, unitPrice: 100 }, { code: "FUR-BED", name: "Bed", quantity: 0, unitPrice: 50 }], 5);
    expect(s.purchase).toBe(200);
    expect(s.runningHeavy.map((x) => x.name)).toEqual(["Dialysis"]); // 48 % a year × 5 > purchase
  });
});

describe("room requirements", () => {
  it("finds the most specific need", () => {
    expect(needFor("IMG-CT-64")?.minArea).toBe(30);
    expect(needFor("MON-PAT-HIGH")).toBeNull();
  });
  it("matches big devices to big enough rooms, one room each, most demanding first", () => {
    const r = checkRooms([
      { boqDepartmentId: 1, department: "Imaging", linked: true, deviceCode: "IMG-CT-64", deviceName: "CT", quantity: 2 },
      { boqDepartmentId: 1, department: "Imaging", linked: true, deviceCode: "IMG-MRI-15", deviceName: "MRI", quantity: 1 },
      { boqDepartmentId: 2, department: "Theatres", linked: false, deviceCode: "SUR-OR-TABLE", deviceName: "Table", quantity: 4 },
    ], [{ id: 1, departmentBoqId: 1, name: "Room A", code: "A", area: 45 }, { id: 2, departmentBoqId: 1, name: "Room B", code: "B", area: 31 }, { id: 3, departmentBoqId: 1, name: "Room C", code: "C", area: 26 }]);
    expect(r.map((x) => [x.device, x.status, x.fitting.map((f) => f.code).join()])).toEqual([["MRI", "ok", "A"], ["Table", "not-linked", ""], ["CT", "short", "B"]]);
    expect(r[2].largest?.code).toBe("B");
  });
});

describe("phasing and cash flow", () => {
  it("cleans phase months into a rising list", () => {
    expect(cleanPhaseMonths([5, 3, "x", 1])).toEqual([0, 3, 12, 12]);
  });
  it("pays an advance at order and the rest on delivery, per quarter", () => {
    expect(leadMonths("IMG-CT-64")).toBe(8);
    const c = cashFlow([{ phase: 1, code: "MON-PAT", amount: 100 }, { phase: 2, code: "IMG-CT-64", amount: 1000 }], "2027-01-01", [0, 6, 12, 18]);
    // monitors: order Sep 2026 (−4), delivery Dec 2026 (−1); CT (opens Jul 2027): order Nov 2026 (−2), delivery Jun 2027 (+5)
    expect(c.rows.map((r) => [r.quarter, Math.round(r.total)])).toEqual([["2026 Q3", 30], ["2026 Q4", 370], ["2027 Q2", 700]]);
    expect(c.rows.at(-1)!.cumulative).toBe(1100);
    expect(c.phases).toEqual([{ phase: 1, amount: 100, opensMonth: 0, opens: "2027 Q1" }, { phase: 2, amount: 1000, opensMonth: 6, opens: "2027 Q3" }]);
  });
});

describe("cost of ownership by device", () => {
  it("adds up one device type across departments", () => {
    const s = tcoSummary([{ code: "THR-HD-MCH", name: "Dialysis", quantity: 1, unitPrice: 100 }, { code: "THR-HD-MCH", name: "Dialysis", quantity: 1, unitPrice: 100 }], 5);
    expect(s.runningHeavy).toHaveLength(1);
    expect(s.runningHeavy[0].purchase).toBe(200);
  });
});

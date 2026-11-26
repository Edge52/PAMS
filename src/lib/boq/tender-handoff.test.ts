import { describe, expect, it } from "vitest";
import { pickLines, planVsOrdered, tenderedLines, tenderHint, toRfqItems, type HandoffLine } from "./tender-handoff";

const L = (id: number, deviceTypeId: number, quantity: number, department: string | null = "ICU"): HandoffLine => ({
  id, deviceTypeId, deviceCode: deviceTypeId === 1 ? "MON-PAT-HIGH" : deviceTypeId === 2 ? "LIF-VEN-ICU" : "INF-PMP-SYR", deviceName: `Type ${deviceTypeId}`, quantity, department,
});
const lines = [L(10, 1, 12, "ICU"), L(11, 1, 4, "ER"), L(12, 2, 6, "ICU"), L(13, 3, 0, "ICU"), L(14, 1, 2, "ICU")];

describe("pickLines", () => {
  it("takes ticked lines and every line of a ticked group", () => {
    expect(pickLines(lines, [12], [1]).map((l) => l.id)).toEqual([10, 11, 12, 14]);
    expect(pickLines(lines, [99]).length).toBe(0);
  });
});

describe("toRfqItems", () => {
  it("one item per device type with added quantities, line ids and departments once", () => {
    const items = toRfqItems(pickLines(lines, [12], [1]));
    expect(items).toEqual([
      { deviceTypeId: 2, code: "LIF-VEN-ICU", name: "Type 2", quantity: 6, boqLineIds: [12], departments: ["ICU"], sortOrder: 0 },
      { deviceTypeId: 1, code: "MON-PAT-HIGH", name: "Type 1", quantity: 18, boqLineIds: [10, 11, 14], departments: ["ICU", "ER"], sortOrder: 1 },
    ]);
  });
  it("leaves out lines with no quantity, and types left empty", () => {
    expect(toRfqItems([L(13, 3, 0)])).toEqual([]);
  });
  it("a hospital-wide line has no department", () => {
    expect(toRfqItems([L(1, 2, 1, null)])[0].departments).toEqual([]);
  });
});

describe("plan vs ordered", () => {
  it("counts lines in an RFQ, orders by BOQ line or by device type, and what is left", () => {
    const tendered = tenderedLines([{ rfqNumber: "RFQ-2026-0002", boqLineIds: [10, 11] }, { rfqNumber: "RFQ-2026-0001", boqLineIds: [10] }]);
    expect(tendered.get(10)).toEqual(["RFQ-2026-0002", "RFQ-2026-0001"]);
    const rows = planVsOrdered(lines, tendered, [
      { boqLineId: 10, deviceTypeId: 1, quantity: 10, received: 4 },
      { boqLineId: null, deviceTypeId: 1, quantity: 3, received: 0 },
      { boqLineId: null, deviceTypeId: 9, quantity: 5, received: 5 }, // not in this BOQ
    ]);
    const mon = rows.find((r) => r.deviceTypeId === 1)!;
    expect(mon).toMatchObject({ planned: 18, inTender: 16, ordered: 13, received: 4, toOrder: 5, rfqs: ["RFQ-2026-0001", "RFQ-2026-0002"] });
    expect(rows.find((r) => r.deviceTypeId === 2)).toMatchObject({ planned: 6, inTender: 0, ordered: 0, toOrder: 6 });
    expect(rows.some((r) => r.deviceTypeId === 9 || r.deviceTypeId === 3)).toBe(false);
  });
  it("never shows a negative amount to order", () => {
    const rows = planVsOrdered([L(1, 2, 2)], new Map(), [{ boqLineId: 1, deviceTypeId: 2, quantity: 5, received: 0 }]);
    expect(rows[0].toOrder).toBe(0);
  });
});

describe("tenderHint", () => {
  it("says the same thing with and without a project", () => {
    expect(tenderHint({ project: null, status: "APPROVED" })).toMatch(/creates the project, links this BOQ/);
    expect(tenderHint({ project: { code: "T-1" }, status: "APPROVED" })).toMatch(/^Linked to T-1/);
    expect(tenderHint({ project: null, status: "DRAFT" })).toMatch(/not approved yet/);
  });
});

import { describe, expect, it } from "vitest";
import { attentionItems, equipmentFigures } from "./executive-calc";

describe("executive summary", () => {
  it("adds up equipment figures and availability", () => {
    const e = equipmentFigures([[1, "IN_SERVICE", 0, 0, 0, 0, 100, 0], [2, "OUT_OF_SERVICE", 1, 1, 1, 24, 50, 1], [3, "IN_STOCK", 0, 0, 0, 0, 10, 0]]);
    expect(e).toMatchObject({ devices: 3, inService: 1, down: 1, availabilityPct: 50, openJobs: 1, overduePpm: 1, recalls: 1, valueEgp: 160 });
  });
  it("lists the worst first and caps the list", () => {
    const eq = equipmentFigures([[1, "IN_SERVICE", 0, 1, 0, 0, 0, 0]]);
    const a = attentionItems({ facilityId: 2, eq, urgentOpen: 2, lateJobs: 1, contractsEnding: 0, warrantyEnding: 3, unsupportedUnits: 0, latePos: 0, pendingApprovals: 4 }, 4);
    expect(a.map((x) => x.text)).toEqual(["2 urgent faults still open", "1 job past the response target", "1 device overdue for planned maintenance", "4 approvals waiting"]);
  });
});

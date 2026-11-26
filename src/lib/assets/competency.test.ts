import { describe, expect, it } from "vitest";
import { assignmentWarning, competencyFor, expiringRecords, expiryKey, isAuthorised, recordState, typeChain, type CompetencyRecord } from "./competency";

const rec = (o: Partial<CompetencyRecord>): CompetencyRecord => ({ id: 1, userId: 7, deviceTypeId: 30, kind: "MAKER", trainedOn: "2026-01-10", expiresOn: null, authorised: true, ...o });
const today = "2026-11-26";

describe("technician competency (wave 40)", () => {
  it("gives a record's state on a day", () => {
    expect(recordState(rec({}), today)).toBe("authorised");
    expect(recordState(rec({ expiresOn: "2026-12-20" }), today)).toBe("expiring");
    expect(recordState(rec({ expiresOn: "2026-11-25" }), today)).toBe("expired");
    expect(recordState(rec({ expiresOn: "2026-11-26" }), today)).toBe("expiring");
    expect(recordState(rec({ authorised: false }), today)).toBe("trained");
  });
  it("follows the type up to its category; the nearest level decides", () => {
    const parents = new Map<number, number | null>([[30, 20], [20, 10], [10, null]]);
    expect(typeChain(30, parents)).toEqual([30, 20, 10]);
    const onCategory = [rec({ deviceTypeId: 10 })];
    expect(competencyFor(onCategory, 7, [30, 20, 10], today).state).toBe("authorised");
    const both = [rec({ id: 1, deviceTypeId: 10 }), rec({ id: 2, deviceTypeId: 30, authorised: false })];
    expect(competencyFor(both, 7, [30, 20, 10], today)).toMatchObject({ state: "trained", record: { id: 2 } });
    expect(competencyFor(both, 8, [30, 20, 10], today).state).toBe("none");
  });
  it("picks the best record on one level and ignores retired ones", () => {
    const rs = [rec({ id: 1, expiresOn: "2026-01-01" }), rec({ id: 2, trainedOn: "2026-06-01" })];
    expect(competencyFor(rs, 7, [30], today).record?.id).toBe(2);
    expect(competencyFor([rec({ active: false })], 7, [30], today).state).toBe("none");
  });
  it("warns, never blocks, when the person is not authorised", () => {
    expect(assignmentWarning("authorised", "Sara", "CT scanner")).toBeNull();
    expect(assignmentWarning("expiring", "Sara", "CT scanner")).toBeNull();
    expect(assignmentWarning("expired", "Sara", "CT scanner")?.problem).toBe("expired");
    expect(assignmentWarning("trained", "Sara", "CT scanner")?.problem).toBe("not_authorised");
    expect(assignmentWarning("none", "Sara", "CT scanner")?.text).toBe("Sara has no training record for CT scanner.");
    expect(isAuthorised("trained")).toBe(false);
  });
  it("lists records running out and keys their reminders", () => {
    const rs = [rec({ id: 1, expiresOn: "2026-12-01" }), rec({ id: 2, expiresOn: "2027-06-01" }), rec({ id: 3, expiresOn: "2026-10-01" }), rec({ id: 4, expiresOn: "2026-12-01", authorised: false })];
    expect(expiringRecords(rs, today).map((x) => [x.record.id, x.expired])).toEqual([[1, false], [3, true]]);
    expect(expiryKey({ id: 1, expiresOn: "2026-12-01" }, false)).toBe("competency_expiring:1:2026-12-01");
  });
});

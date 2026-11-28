import { describe, expect, it } from "vitest";
import { isOverdue, sortVisits, visitFor, type VisitCandidate } from "./my-visits";

const today = "2026-11-29";
const base: VisitCandidate = { status: "SCHEDULED", scheduledDate: "2026-12-01", hasJob: false, assetStatus: "IN_SERVICE", facilityId: 1, usualTechId: null };
const me = { id: 7, scope: null };
const team = new Map([[1, [7, 8]], [2, [8]]]);
const canWorkIn = (u: number, f: number) => team.get(f)?.includes(u) ?? false;

describe("planned visits in My jobs", () => {
  it("shows a due visit without a job to the team", () => {
    expect(visitFor(base, me, today, canWorkIn)).toBe("team");
    expect(visitFor({ ...base, status: "OVERDUE", scheduledDate: "2026-10-01" }, me, today, canWorkIn)).toBe("team");
  });
  it("leaves out visits with a job, done or cancelled, far off, undated, or on a disposed device", () => {
    expect(visitFor({ ...base, hasJob: true }, me, today, canWorkIn)).toBeNull();
    expect(visitFor({ ...base, status: "COMPLETED" }, me, today, canWorkIn)).toBeNull();
    expect(visitFor({ ...base, scheduledDate: "2026-12-07" }, me, today, canWorkIn)).toBeNull(); // 8 days ahead
    expect(visitFor({ ...base, scheduledDate: "2026-12-06" }, me, today, canWorkIn)).toBe("team"); // 7 days ahead
    expect(visitFor({ ...base, scheduledDate: null }, me, today, canWorkIn)).toBeNull();
    expect(visitFor({ ...base, assetStatus: "DISPOSED" }, me, today, canWorkIn)).toBeNull();
  });
  it("goes to the device's usual technician while they can work there", () => {
    expect(visitFor({ ...base, usualTechId: 7 }, me, today, canWorkIn)).toBe("mine");
    expect(visitFor({ ...base, usualTechId: 8 }, me, today, canWorkIn)).toBeNull(); // someone else's
    expect(visitFor({ ...base, usualTechId: 9 }, me, today, canWorkIn)).toBe("team"); // they left: back to the team
  });
  it("only in hospitals this person works in", () => {
    expect(visitFor({ ...base, facilityId: 2 }, me, today, canWorkIn)).toBeNull();
    expect(visitFor(base, { id: 7, scope: [2] }, today, canWorkIn)).toBeNull();
  });
  it("puts overdue visits first", () => {
    expect(isOverdue({ status: "SCHEDULED", scheduledDate: "2026-11-28" }, today)).toBe(true);
    expect(isOverdue({ status: "SCHEDULED", scheduledDate: today }, today)).toBe(false);
    const s = sortVisits([{ scheduledDate: "2026-12-02", overdue: false }, { scheduledDate: "2026-11-01", overdue: true }, { scheduledDate: "2026-11-30", overdue: false }]);
    expect(s.map((x) => x.scheduledDate)).toEqual(["2026-11-01", "2026-11-30", "2026-12-02"]);
  });
});

import { describe, expect, it } from "vitest";
import { addMonths, daysBetween, endOfMonth, monthLabel } from "./dates";
import {
  DEFAULT_PPM_INTERVAL_MONTHS, displayEventStatus, dueState, groupByMonth, lifecycle, nextPpmDue, planPpmEvents,
  ppmDatesInWindow, warrantyState,
} from "./maintenance";

const today = "2026-10-27";

describe("dates", () => {
  it("adds months clamping to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-10-27", 12)).toBe("2027-10-27");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
  it("computes day differences and month bounds", () => {
    expect(daysBetween("2026-10-27", "2026-11-26")).toBe(30);
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});

describe("nextPpmDue", () => {
  it("uses the last completed PPM first", () => {
    const n = nextPpmDue({ id: 1, installDate: "2024-01-10", lastPpmDate: "2026-04-01", ppmIntervalMonths: 6 });
    expect(n).toMatchObject({ due: "2026-10-01", basis: "last_ppm", intervalMonths: 6, isDefaultInterval: false });
  });
  it("falls back to install date, then purchase date", () => {
    expect(nextPpmDue({ id: 1, installDate: "2026-05-01", purchaseDate: "2026-01-01", ppmIntervalMonths: 6 }).due).toBe("2026-11-01");
    expect(nextPpmDue({ id: 1, purchaseDate: "2026-01-01", ppmIntervalMonths: 3 })).toMatchObject({ due: "2026-04-01", basis: "purchase" });
  });
  it("uses a default annual interval when the catalogue has none", () => {
    const n = nextPpmDue({ id: 1, installDate: "2026-01-01", ppmIntervalMonths: null });
    expect(n.intervalMonths).toBe(DEFAULT_PPM_INTERVAL_MONTHS);
    expect(n.isDefaultInterval).toBe(true);
    expect(n.due).toBe("2027-01-01");
  });
  it("returns nothing for disposed or undated assets", () => {
    expect(nextPpmDue({ id: 1, status: "DISPOSED", installDate: "2026-01-01" }).due).toBeNull();
    expect(nextPpmDue({ id: 1 }).due).toBeNull();
  });
});

describe("dueState", () => {
  it("classifies overdue, due soon and upcoming", () => {
    expect(dueState("2026-10-26", today)).toBe("OVERDUE");
    expect(dueState("2026-10-27", today)).toBe("DUE_SOON");
    expect(dueState("2026-11-26", today)).toBe("DUE_SOON");
    expect(dueState("2026-11-27", today)).toBe("UPCOMING");
    expect(dueState(null, today)).toBe("NONE");
  });
});

describe("ppmDatesInWindow / planPpmEvents", () => {
  const a = { id: 7, installDate: "2026-01-15", ppmIntervalMonths: 3 };
  it("lists every due date inside the window", () => {
    expect(ppmDatesInWindow(a, "2026-01-01", "2026-12-31")).toEqual(["2026-04-15", "2026-07-15", "2026-10-15"]);
  });
  it("plans an overdue asset on the first day of the window, then continues the cycle", () => {
    expect(ppmDatesInWindow({ id: 1, installDate: "2025-01-01", ppmIntervalMonths: 6 }, "2026-11-01", "2027-06-30"))
      .toEqual(["2026-11-01", "2027-05-01"]);
  });
  it("skips months that already have a PPM event and ignores cancelled ones", () => {
    const plan = planPpmEvents([a, { id: 8, installDate: "2026-02-01", ppmIntervalMonths: 12 }], [
      { assetId: 7, scheduledDate: "2026-07-02", status: "COMPLETED", type: "PPM" },
      { assetId: 7, scheduledDate: "2026-10-30", status: "CANCELLED", type: "PPM" },
      { assetId: 8, scheduledDate: "2027-02-10", status: "SCHEDULED", type: "CORRECTIVE" },
    ], "2026-01-01", "2027-03-31");
    expect(plan).toEqual([
      { assetId: 7, scheduledDate: "2026-04-15" },
      { assetId: 7, scheduledDate: "2026-10-15" },
      { assetId: 7, scheduledDate: "2027-01-15" },
      { assetId: 8, scheduledDate: "2027-02-01" },
    ]);
  });
  it("does not add a catch-up visit when an overdue work order is already open", () => {
    const late = { id: 9, installDate: "2025-01-01", ppmIntervalMonths: 6 };
    const open = [{ assetId: 9, scheduledDate: "2025-07-01", status: "SCHEDULED", type: "PPM" }];
    expect(planPpmEvents([late], open, "2026-11-01", "2027-06-30")).toEqual([{ assetId: 9, scheduledDate: "2027-05-01" }]);
    expect(planPpmEvents([late], [], "2026-11-01", "2027-06-30")).toHaveLength(2);
  });
  it("returns nothing for an inverted window", () => {
    expect(ppmDatesInWindow(a, "2026-12-01", "2026-01-01")).toEqual([]);
  });
});

describe("event status, warranty and lifecycle", () => {
  it("shows open past events as overdue", () => {
    expect(displayEventStatus({ status: "SCHEDULED", scheduledDate: "2026-10-01" }, today)).toBe("OVERDUE");
    expect(displayEventStatus({ status: "SCHEDULED", scheduledDate: "2026-11-01" }, today)).toBe("SCHEDULED");
    expect(displayEventStatus({ status: "COMPLETED", scheduledDate: "2026-10-01" }, today)).toBe("COMPLETED");
  });
  it("classifies warranties", () => {
    expect(warrantyState(null, today).state).toBe("NONE");
    expect(warrantyState("2026-10-01", today)).toEqual({ state: "EXPIRED", days: -26 });
    expect(warrantyState("2027-01-20", today).state).toBe("EXPIRING");
    expect(warrantyState("2027-06-01", today).state).toBe("ACTIVE");
  });
  it("computes lifecycle against life expectancy", () => {
    expect(lifecycle("2016-06-01", 10, today).state).toBe("BEYOND");
    expect(lifecycle("2018-10-27", 10, today).state).toBe("NEAR_END");
    const l = lifecycle("2024-10-27", 10, today);
    expect(l.state).toBe("OK");
    expect(Math.round(l.pctUsed ?? 0)).toBe(20);
    expect(lifecycle(null, 10, today).state).toBe("UNKNOWN");
  });
  it("groups by month in order", () => {
    const g = groupByMonth([{ d: "2026-12-01" }, { d: "2026-11-05" }, { d: "2026-11-20" }, { d: null }], (x) => x.d);
    expect(g.map((x) => [x.month, x.items.length])).toEqual([["2026-11", 2], ["2026-12", 1]]);
  });
});

import { describe, expect, it } from "vitest";
import { bucketOf, colorFor, deviceValue, legendFor, RAMP, roomValues, type LiveMetrics } from "./layers";

const m = (o: Partial<LiveMetrics> = {}): LiveMetrics => ({ status: "IN_SERVICE", openJobs: 0, overduePpm: false, beyondLife: false, downtimeHours: 0, valueEgp: 0, recall: false, ...o });
const rooms = [{ id: 1, departmentId: 10 }, { id: 2, departmentId: 10 }, { id: 3, departmentId: 20 }, { id: 4, departmentId: null }];

describe("problem layers", () => {
  it("reads one device's contribution", () => {
    expect(deviceValue("faults", m({ openJobs: 2 }))).toBe(2);
    expect(deviceValue("ppm", m({ overduePpm: true }))).toBe(1);
    expect(deviceValue("value", m({ valueEgp: 5000 }))).toBe(5000);
    expect(deviceValue("department", m({ openJobs: 3 }))).toBe(0);
  });
  it("sums per room, skipping disposed and unplaced devices", () => {
    const v = roomValues("faults", "room", rooms, [
      { roomId: 1, metrics: m({ openJobs: 1 }) }, { roomId: 1, metrics: m({ openJobs: 2 }) },
      { roomId: 3, metrics: m({ openJobs: 1, status: "DISPOSED" }) }, { roomId: null, metrics: m({ openJobs: 5 }) }, { roomId: 4, metrics: undefined },
    ]);
    expect([...v]).toEqual([[1, 3]]);
  });
  it("spreads department totals over every room of the department", () => {
    const v = roomValues("life", "department", rooms, [
      { roomId: 1, metrics: m({ beyondLife: true }) }, { roomId: 2, metrics: m({ beyondLife: true }) }, { roomId: 4, metrics: m({ beyondLife: true }) },
    ]);
    expect(Object.fromEntries(v)).toEqual({ 1: 2, 2: 2, 4: 1 });
  });
  it("uses fixed steps for counts", () => {
    const l = legendFor("faults", [1, 1, 2, 4, 9, 0])!;
    expect(l.breaks).toEqual([1, 2, 3, 5]);
    expect(l.labels).toEqual(["1", "2", "3–4", "5 or more"]);
    expect(l.counts).toEqual([2, 1, 1, 1]);
    expect(colorFor(4, l)).toBe(RAMP[2]);
    expect(colorFor(0, l)).toBeNull();
  });
  it("uses quartiles for hours and money", () => {
    const l = legendFor("downtime", [10, 20, 30, 40, 50, 60, 70, 80])!;
    expect(l.breaks).toEqual([10, 20, 40, 60]);
    expect(l.labels[0]).toBe("10 h – 20 h");
    expect(l.labels[3]).toBe("3 days or more"); // 60 h shows in days
    expect(bucketOf(65, l.breaks)).toBe(3);
  });
  it("keeps breaks strictly increasing when values repeat", () => {
    const l = legendFor("value", [5000, 5000, 5000])!;
    for (let i = 1; i < l.breaks.length; i++) expect(l.breaks[i]).toBeGreaterThan(l.breaks[i - 1]);
    expect(colorFor(5000, l)).toBe(RAMP[0]);
  });
  it("has no legend for departments", () => {
    expect(legendFor("department", [1, 2])).toBeNull();
    expect(roomValues("department", "room", rooms, [{ roomId: 1, metrics: m({ openJobs: 1 }) }]).size).toBe(0);
  });
});

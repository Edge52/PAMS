import { describe, expect, it } from "vitest";
import {
  benchTone, deviceWindow, downHours, failuresByCode, mergeIntervals, mtbfHours, mttr, noProblemFound, periodMs, ppmOnTime, ppmYield,
  repeatFailures, rollUpUptime, uptimeByDevice, uptimeKpi, type Job, type UptimeDevice,
} from "./maintenance";

const P = { from: "2026-11-01", to: "2026-11-10" }; // 10 days = 240 h
const LATE = new Date("2026-12-31T00:00:00Z");
const dev = (id: number, x: Partial<UptimeDevice> = {}): UptimeDevice => ({
  id, typeId: 1, typeLabel: "Monitor", departmentId: 1, departmentLabel: "ICU", imaging: false, ...x,
});

describe("intervals", () => {
  it("merges overlapping and touching intervals", () => {
    expect(mergeIntervals([{ start: 5, end: 10 }, { start: 0, end: 6 }, { start: 10, end: 12 }, { start: 20, end: 21 }]))
      .toEqual([{ start: 0, end: 12 }, { start: 20, end: 21 }]);
  });
  it("drops empty intervals", () => expect(mergeIntervals([{ start: 3, end: 3 }])).toEqual([]));
});

describe("downtime", () => {
  const w = periodMs(P);
  it("counts overlapping downtime on one device once", () => {
    const r = downHours([
      { start: "2026-11-02T00:00:00Z", end: "2026-11-02T10:00:00Z" },
      { start: "2026-11-02T05:00:00Z", end: "2026-11-02T12:00:00Z" },
    ], w);
    expect(r).toEqual({ hours: 12, outages: 1 });
  });
  it("runs open downtime to the end of the window", () => {
    expect(downHours([{ start: "2026-11-10T12:00:00Z", end: null }], w).hours).toBe(12);
  });
  it("clips downtime that started before the period", () => {
    expect(downHours([{ start: "2026-10-30T00:00:00Z", end: "2026-11-01T06:00:00Z" }], w).hours).toBe(6);
  });
  it("ignores downtime outside the period", () => {
    expect(downHours([{ start: "2026-11-20T00:00:00Z", end: "2026-11-21T00:00:00Z" }], w)).toEqual({ hours: 0, outages: 0 });
  });
});

describe("device window", () => {
  it("is the whole period for a device installed before it", () => {
    const w = deviceWindow({ installedOn: "2025-01-01" }, P, LATE)!;
    expect((w.end - w.start) / 3_600_000).toBe(240);
  });
  it("starts at the install date for a device installed mid-period", () => {
    const w = deviceWindow({ installedOn: "2026-11-06" }, P, LATE)!;
    expect((w.end - w.start) / 3_600_000).toBe(120);
  });
  it("ends at now when the period runs into the future", () => {
    const w = deviceWindow({}, P, new Date("2026-11-05T00:00:00Z"))!;
    expect((w.end - w.start) / 3_600_000).toBe(96);
  });
  it("ends at disposal, and is empty for a device installed after the period", () => {
    const w = deviceWindow({ leftOn: "2026-11-02" }, P, LATE)!;
    expect((w.end - w.start) / 3_600_000).toBe(48);
    expect(deviceWindow({ installedOn: "2026-12-01" }, P, LATE)).toBeNull();
  });
});

describe("uptime", () => {
  it("works out uptime per device from downtime", () => {
    const [r] = uptimeByDevice([dev(1)], [{ assetId: 1, start: "2026-11-03T00:00:00Z", end: "2026-11-04T00:00:00Z" }], P, LATE);
    expect(r.hours).toBe(240);
    expect(r.downHours).toBe(24);
    expect(r.uptime).toBeCloseTo(0.9);
  });
  it("counts open downtime up to now only", () => {
    const [r] = uptimeByDevice([dev(1)], [{ assetId: 1, start: "2026-11-04T00:00:00Z", end: null }], P, new Date("2026-11-05T00:00:00Z"));
    expect(r.hours).toBe(96);
    expect(r.downHours).toBe(24);
    expect(r.uptime).toBeCloseTo(0.75);
  });
  it("judges a device installed mid-period on its own hours", () => {
    const [r] = uptimeByDevice([dev(1, { installedOn: "2026-11-06" })], [{ assetId: 1, start: "2026-11-01T00:00:00Z", end: "2026-11-07T00:00:00Z" }], P, LATE);
    expect(r.hours).toBe(120);
    expect(r.downHours).toBe(24); // the downtime before install doesn't count
  });
  it("leaves out devices not in the period", () => {
    expect(uptimeByDevice([dev(1, { installedOn: "2027-01-01" })], [], P, LATE)).toEqual([]);
  });
  it("rolls up by hours, so bigger groups weigh more", () => {
    const devices = [dev(1), dev(2), dev(3, { typeId: 2, typeLabel: "CT", imaging: true, installedOn: "2026-11-06" })];
    const rows = uptimeByDevice(devices, [
      { assetId: 1, start: "2026-11-01T00:00:00Z", end: "2026-11-02T00:00:00Z" },
      { assetId: 3, start: "2026-11-06T00:00:00Z", end: "2026-11-07T00:00:00Z" },
    ], P, LATE);
    const [fleet] = rollUpUptime(devices, rows, () => ({ key: "all", label: "All" }));
    expect(fleet.devices).toBe(3);
    expect(fleet.hours).toBe(600);
    expect(fleet.uptime).toBeCloseTo(1 - 48 / 600);
    expect(fleet.imaging).toBe(false);
    const byType = rollUpUptime(devices, rows, (d) => ({ key: String(d.typeId), label: d.typeLabel }));
    expect(byType[0].label).toBe("CT"); // lowest uptime first
    expect(byType[0].imaging).toBe(true);
    expect(byType[0].uptime).toBeCloseTo(0.8);
  });
});

const job = (id: number, assetId: number, x: Partial<Job> = {}): Job => ({
  id, assetId, type: "CORRECTIVE", status: "CLOSED", reportedAt: "2026-11-02T08:00:00Z", completedAt: "2026-11-02T14:00:00Z",
  failureCode: "WEAR", deviceDown: true, downtimeStart: null, downtimeEnd: null, ...x,
});

describe("failures and repairs", () => {
  const jobs = [
    job(1, 1), job(2, 1, { failureCode: "NO_PROBLEM_FOUND" }), job(3, 1, { failureCode: null }),
    job(4, 2, { completedAt: "2026-11-03T08:00:00Z" }),
    job(5, 2, { status: "CANCELLED" }), job(6, 2, { type: "PPM" }),
    job(7, 3, { reportedAt: "2026-10-20T00:00:00Z", completedAt: "2026-10-21T00:00:00Z" }),
  ];
  it("finds devices with 3 or more corrective jobs in the period", () => {
    expect(repeatFailures(jobs, P)).toEqual([{ assetId: 1, count: 3 }]);
  });
  it("counts failures by code, with not recorded apart", () => {
    expect(failuresByCode(jobs, P)).toEqual([
      { code: "WEAR", count: 2 }, { code: "NO_PROBLEM_FOUND", count: 1 }, { code: null, count: 1 },
    ]);
  });
  it("works out the no-problem-found share of coded failures", () => {
    expect(noProblemFound(jobs, P)).toEqual({ share: 1 / 3, n: 3, npf: 1 });
  });
  it("averages repair time over jobs completed in the period", () => {
    // 6, 6, 6, 24 hours
    expect(mttr(jobs, P)).toEqual({ hours: 10.5, n: 4 });
  });
  it("works out MTBF from hours in service and failures", () => {
    expect(mtbfHours([{ id: 1, hours: 240, downHours: 40, uptime: null, outages: 1 }], 4)).toBe(50);
    expect(mtbfHours([], 0)).toBeNull();
  });
});

describe("planned maintenance", () => {
  const v = (scheduledDate: string, completedDate: string | null, faultFound = false) =>
    ({ status: completedDate ? "COMPLETED" : "SCHEDULED", scheduledDate, completedDate, faultFound });
  it("works out PPM yield from completed visits", () => {
    const r = ppmYield([v("2026-11-02", "2026-11-02", true), v("2026-11-03", "2026-11-03"), v("2026-11-04", "2026-11-04"), v("2026-11-05", null), v("2026-10-01", "2026-10-01", true)], P);
    expect(r).toEqual({ share: 1 / 3, n: 3, faults: 1 });
  });
  it("works out PPM on time like the compliance report", () => {
    const r = ppmOnTime([v("2026-11-02", "2026-11-02"), v("2026-11-03", "2026-11-06"), v("2026-11-04", null), v("2026-11-30", null)], P, "2026-11-20", 0);
    expect(r).toEqual({ share: 1 / 3, n: 3, onTime: 1 });
    expect(ppmOnTime([], P, "2026-11-20").share).toBeNull();
    // 7 days' grace by default, as the compliance report
    expect(ppmOnTime([v("2026-11-03", "2026-11-06")], P, "2026-11-20").share).toBe(1);
  });
});

describe("KPIs", () => {
  it("uses the imaging benchmark for imaging", () => {
    expect(uptimeKpi({ uptime: 0.97, devices: 6 }, true).benchmark?.text).toMatch(/98 %/);
    expect(uptimeKpi({ uptime: 0.97, devices: 6 }).benchmark?.text).toMatch(/94 %/);
  });
  it("tones a value against its target", () => {
    expect(benchTone(0.95, 0.94, true)).toBe("ok");
    expect(benchTone(0.2, 0.12, false)).toBe("warn");
    expect(benchTone(null, 0.12, false)).toBeUndefined();
  });
});

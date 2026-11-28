import { describe, expect, it } from "vitest";
import { ackDeadline, ackTargets, faultClass, faultLevelDue, formatMinutes, responseMinutes, responseOnTime, targetLabel } from "./fault-escalation";

const wo = (reportedAt: string, extra: Partial<{ status: string; type: string; assignedAt: Date | null; startedAt: Date | null }> = {}) => ({
  type: "CORRECTIVE", status: "OPEN", reportedAt: new Date(reportedAt), assignedAt: null, startedAt: null, ...extra,
});

describe("fault report escalation (wave 41)", () => {
  it("classes faults", () => {
    expect(faultClass("NORMAL", "LIFE_SUPPORT")).toBe("LIFE_SUPPORT");
    expect(faultClass("URGENT", "LOW")).toBe("LIFE_SUPPORT");
    expect(faultClass("HIGH", null)).toBe("HIGH");
    expect(faultClass("LOW", "MEDIUM")).toBe("LOW");
  });
  it("reads targets with defaults", () => {
    expect(ackTargets({})).toEqual({ LIFE_SUPPORT: 30, HIGH: 120, NORMAL: 1440, LOW: 2880 });
    expect(ackTargets({ HIGH: 60, LOW: 1 }).HIGH).toBe(60);
    expect(ackTargets({ LOW: 1 }).LOW).toBe(2880);
    expect([30, 120, 1440, 90].map(targetLabel)).toEqual(["30 min", "2 h", "1 working day", "90 min"]);
  });
  it("counts whole days as working days", () => {
    // Thursday 10:00 Cairo + 1 working day = Sunday 10:00.
    expect(ackDeadline(new Date("2026-11-26T08:00:00Z"), 1440).toISOString()).toBe("2026-11-29T08:00:00.000Z");
    expect(ackDeadline(new Date("2026-11-26T08:00:00Z"), 30).toISOString()).toBe("2026-11-26T08:30:00.000Z");
  });
  it("skips the hospital's public holidays (wave 43)", () => {
    // Sunday 29 Nov a holiday: Thursday + 1 working day = Monday.
    expect(ackDeadline(new Date("2026-11-26T08:00:00Z"), 1440, ["2026-11-29"]).toISOString()).toBe("2026-11-30T08:00:00.000Z");
    expect(ackDeadline(new Date("2026-11-26T08:00:00Z"), 30, ["2026-11-26"]).toISOString()).toBe("2026-11-26T08:30:00.000Z");
  });
  it("re-notifies past the target and escalates at twice it", () => {
    const w = wo("2026-11-26T08:00:00Z");
    expect(faultLevelDue(w, 30, new Date("2026-11-26T08:20:00Z"))).toBe(0);
    expect(faultLevelDue(w, 30, new Date("2026-11-26T08:31:00Z"))).toBe(1);
    expect(faultLevelDue(w, 30, new Date("2026-11-26T09:00:00Z"))).toBe(2);
    expect(faultLevelDue({ ...w, status: "ASSIGNED", assignedAt: new Date("2026-11-26T08:10:00Z") }, 30, new Date("2026-11-26T10:00:00Z"))).toBe(0);
    expect(faultLevelDue({ ...w, type: "PPM" }, 30, new Date("2026-11-26T10:00:00Z"))).toBe(0);
  });
  it("measures the response time", () => {
    const w = wo("2026-11-26T08:00:00Z", { assignedAt: new Date("2026-11-26T08:45:00Z"), startedAt: new Date("2026-11-26T08:40:00Z") });
    expect(responseMinutes(w)).toBe(40);
    expect(responseOnTime(w, 30, new Date())).toBe(false);
    expect(responseOnTime(w, 120, new Date())).toBe(true);
    expect(responseMinutes(wo("2026-11-26T08:00:00Z"))).toBeNull();
    expect(responseOnTime(wo("2026-11-26T08:00:00Z"), 30, new Date("2026-11-26T08:10:00Z"))).toBeNull();
    expect([12, 185, 3000].map(formatMinutes)).toEqual(["12 min", "3 h 5 min", "2 d 2 h"]);
  });
});

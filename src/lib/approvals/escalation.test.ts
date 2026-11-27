import { describe, expect, it } from "vitest";
import type { StepState } from "./core";
import {
  addWorkingDays, canDecideFor, delegationProblem, deputyOf, escalationDays, escalationLevelDue, escalationRole,
  isWorkingDay, principalsOf, withDeputies, workingDaysBetween, type Delegation,
} from "./escalation";

describe("working days (Egypt: Friday and Saturday off)", () => {
  it("knows the weekend", () => {
    expect(isWorkingDay("2026-11-26")).toBe(true); // Thursday
    expect(isWorkingDay("2026-11-27")).toBe(false); // Friday
    expect(isWorkingDay("2026-11-28")).toBe(false); // Saturday
    expect(isWorkingDay("2026-11-29")).toBe(true); // Sunday
    expect(isWorkingDay("2026-11-29", ["2026-11-29"])).toBe(false);
  });
  it("counts working days after the start, the end included", () => {
    expect(workingDaysBetween("2026-11-26", "2026-11-26")).toBe(0);
    expect(workingDaysBetween("2026-11-26", "2026-11-28")).toBe(0); // Thu → Sat
    expect(workingDaysBetween("2026-11-26", "2026-11-29")).toBe(1); // → Sun
    expect(workingDaysBetween("2026-11-26", "2026-12-03")).toBe(5); // a full week
    expect(workingDaysBetween("2026-11-26", "2026-12-01", ["2026-11-30"])).toBe(2);
    expect(workingDaysBetween("2026-12-01", "2026-11-26")).toBe(0);
  });
  it("adds working days", () => {
    expect(addWorkingDays("2026-11-26", 1)).toBe("2026-11-29");
    expect(addWorkingDays("2026-11-27", 1)).toBe("2026-11-29"); // reported on Friday
    expect(addWorkingDays("2026-11-29", 3)).toBe("2026-12-02");
  });
});

describe("escalation levels", () => {
  it("reads the setting per entity with a default of 3", () => {
    expect(escalationDays("PO", {})).toBe(3);
    expect(escalationDays("PO", { PO: 5 })).toBe(5);
    expect(escalationDays("BOQ", { BOQ: 0 })).toBe(3);
  });
  it("reminds at N working days and escalates at twice that", () => {
    expect(escalationLevelDue(2, 3)).toBe(0);
    expect(escalationLevelDue(3, 3)).toBe(1);
    expect(escalationLevelDue(6, 3)).toBe(2);
    expect(escalationRole("PROCUREMENT")).toBe("DIRECTOR");
    expect(escalationRole("DIRECTOR")).toBe("ADMIN");
  });
});

describe("delegation", () => {
  const d = (userId: number, deputyId: number, startsOn = "2026-11-20", endsOn = "2026-11-30", extra: Partial<Delegation> = {}): Delegation => ({ userId, deputyId, startsOn, endsOn, ...extra });
  it("passes approvals to the deputy only during the dates", () => {
    const list = [d(1, 2)];
    expect(deputyOf(1, list, "2026-11-26")).toBe(2);
    expect(deputyOf(1, list, "2026-11-30")).toBe(2);
    expect(deputyOf(1, list, "2026-12-01")).toBeNull();
    expect(deputyOf(1, [d(1, 2, "2026-11-20", "2026-11-30", { cancelled: true })], "2026-11-26")).toBeNull();
  });
  it("follows a deputy who is out too, without going round in a circle", () => {
    expect(deputyOf(1, [d(1, 2), d(2, 3)], "2026-11-26")).toBe(3);
    expect(deputyOf(1, [d(1, 2), d(2, 1)], "2026-11-26")).toBe(2);
    expect(principalsOf(3, [d(1, 2), d(2, 3)], "2026-11-26").sort()).toEqual([1, 2]);
    expect(withDeputies([1, 4, 2], [d(1, 2)], "2026-11-26")).toEqual([2, 4]);
  });
  it("checks a new delegation", () => {
    expect(delegationProblem(d(1, 1), [], "2026-11-26")).toMatch(/someone else/);
    expect(delegationProblem(d(1, 2, "2026-12-05", "2026-12-01"), [], "2026-11-26")).toMatch(/before/);
    expect(delegationProblem(d(1, 2, "2026-11-01", "2026-11-05"), [], "2026-11-26")).toMatch(/past/);
    expect(delegationProblem(d(1, 3, "2026-11-28", "2026-12-02"), [d(1, 2, "2026-11-20", "2026-11-30", { id: 9 })], "2026-11-26")).toMatch(/already/);
    expect(delegationProblem(d(1, 2), [d(2, 1, "2026-11-25", "2026-11-27")], "2026-11-26")).toMatch(/own deputy/);
    expect(delegationProblem(d(1, 2), [], "2026-11-26")).toBeNull();
  });
  it("lets the deputy decide for the person, with the same separation of duties", () => {
    const step: StepState = { id: 10, stepOrder: 1, status: "PENDING", approverRole: "DIRECTOR", approverUserId: null, memberName: null, decidedById: null };
    const ctx = { entity: "PO" as const, requestStatus: "PENDING" as const, requestedById: 5, steps: [step] };
    expect(canDecideFor(step, { id: 2 }, { id: 1, role: "DIRECTOR" }, ctx)).toEqual({ ok: true });
    expect(canDecideFor(step, { id: 5 }, { id: 1, role: "DIRECTOR" }, ctx).ok).toBe(false); // the deputy submitted it
    expect(canDecideFor(step, { id: 2 }, { id: 1, role: "FINANCE" }, ctx).ok).toBe(false); // the person can't decide it
    const named = { ...step, approverRole: null, approverUserId: 1 };
    expect(canDecideFor(named, { id: 2 }, { id: 1, role: "DIRECTOR" }, ctx).ok).toBe(false); // committee signature
    const namedRole = { ...step, approverUserId: 1 };
    expect(canDecideFor(namedRole, { id: 2 }, { id: 1, role: "DIRECTOR" }, ctx)).toEqual({ ok: true });
  });
});

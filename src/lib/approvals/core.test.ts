import { describe, expect, it } from "vitest";
import { advance, buildSteps, canDecide, canRecordPaper, policyApplies, votesNeeded, type Policy, type StepState } from "./core";

const P = (id: number, over: Partial<Policy>): Policy => ({
  id, entity: "PO", label: `Policy ${id}`, approverRole: "PROCUREMENT", minAmountEgp: 0, maxAmountEgp: null, stepOrder: 1,
  facilityId: null, active: true, ...over,
});
const PO_DEFAULTS = [
  P(1, { label: "Procurement manager", approverRole: "PROCUREMENT", stepOrder: 1 }),
  P(2, { label: "Finance", approverRole: "FINANCE", minAmountEgp: 1_000_000, stepOrder: 2 }),
  P(3, { label: "Hospital director", approverRole: "DIRECTOR", minAmountEgp: 2_000_000, stepOrder: 3 }),
];

describe("buildSteps", () => {
  it("adds steps by amount (thresholds inclusive)", () => {
    expect(buildSteps({ entity: "PO", policies: PO_DEFAULTS, amountEgp: 500_000 }).map((s) => s.label)).toEqual(["Procurement manager"]);
    expect(buildSteps({ entity: "PO", policies: PO_DEFAULTS, amountEgp: 1_000_000 }).map((s) => s.label)).toEqual(["Procurement manager", "Finance"]);
    const big = buildSteps({ entity: "PO", policies: PO_DEFAULTS, amountEgp: 4_200_000 });
    expect(big.map((s) => [s.stepOrder, s.approverRole])).toEqual([[1, "PROCUREMENT"], [2, "FINANCE"], [3, "DIRECTOR"]]);
  });
  it("respects max (exclusive), inactive rows and facility-specific rows", () => {
    const ps = [P(1, { maxAmountEgp: 100 }), P(2, { active: false }), P(3, { facilityId: 7, approverRole: "FINANCE" })];
    expect(buildSteps({ entity: "PO", policies: ps, amountEgp: 100, facilityId: 8 })).toEqual([]);
    expect(buildSteps({ entity: "PO", policies: ps, amountEgp: 99, facilityId: 7 }).map((s) => s.approverRole)).toEqual(["PROCUREMENT", "FINANCE"]);
    expect(policyApplies(P(9, { entity: "BOQ", minAmountEgp: 1e9 }), "BOQ", null, null)).toBe(true); // no amounts for BOQs
  });
  it("renumbers gaps and runs same-order policies together", () => {
    const ps = [P(1, { stepOrder: 10 }), P(2, { stepOrder: 10, approverRole: "FINANCE" }), P(3, { stepOrder: 30, approverRole: "DIRECTOR" })];
    expect(buildSteps({ entity: "PO", policies: ps, amountEgp: 1 }).map((s) => s.stepOrder)).toEqual([1, 1, 2]);
  });
  it("puts committee members first on an award, then the competent authority", () => {
    const steps = buildSteps({
      entity: "AWARD", policies: [P(5, { entity: "AWARD", approverRole: "DIRECTOR", label: "Competent authority" })],
      committeeMembers: [{ userId: 3, name: "Omar", label: "Chair — Omar" }, { userId: null, name: "MoF rep", label: "Ministry of Finance — MoF rep" }],
    });
    expect(steps).toEqual([
      { stepOrder: 1, label: "Chair — Omar", approverRole: null, approverUserId: 3, memberName: null },
      { stepOrder: 1, label: "Ministry of Finance — MoF rep", approverRole: null, approverUserId: null, memberName: "MoF rep" },
      { stepOrder: 2, label: "Competent authority", approverRole: "DIRECTOR", approverUserId: null, memberName: null },
    ]);
  });
  it("ignores committee members on other entities", () => {
    expect(buildSteps({ entity: "BOQ", policies: [], committeeMembers: [{ userId: 1, name: "x", label: "x" }] })).toEqual([]);
  });
});

const S = (id: number, stepOrder: number, status: StepState["status"], over: Partial<StepState> = {}): StepState => ({
  id, stepOrder, status, approverRole: "FINANCE", approverUserId: null, memberName: null, decidedById: null, ...over,
});
const M = (id: number, status: StepState["status"], userId: number | null = id) => S(id, 1, status, { approverRole: null, approverUserId: userId, memberName: userId ? null : `Ext ${id}` });

describe("advance", () => {
  it("opens the first order of a fresh request", () => {
    const r = advance([S(1, 1, "WAITING"), S(2, 2, "WAITING")], "all");
    expect(r.status).toBe("PENDING");
    expect(r.newlyPending).toEqual([1]);
    expect(r.changes.get(2)).toBeUndefined();
  });
  it("waits for every step of an order before opening the next", () => {
    const r = advance([S(1, 1, "APPROVED"), S(2, 1, "PENDING"), S(3, 2, "WAITING")], "all");
    expect(r.status).toBe("PENDING");
    expect(r.newlyPending).toEqual([]);
    const r2 = advance([S(1, 1, "APPROVED"), S(2, 1, "APPROVED"), S(3, 2, "WAITING")], "all");
    expect(r2.newlyPending).toEqual([3]);
  });
  it("approves when every order is complete", () => {
    expect(advance([S(1, 1, "APPROVED"), S(2, 2, "APPROVED")], "all").status).toBe("APPROVED");
  });
  it("any policy rejection rejects and skips the rest", () => {
    const r = advance([S(1, 1, "APPROVED"), S(2, 2, "REJECTED"), S(3, 3, "WAITING")], "all");
    expect(r.status).toBe("REJECTED");
    expect(r.changes.get(3)).toBe("SKIPPED");
    expect(r.newlyPending).toEqual([]);
  });
  it("an empty request is approved", () => {
    expect(advance([], "all").status).toBe("APPROVED");
  });
  describe("committee quorum", () => {
    const authority = S(9, 2, "WAITING", { approverRole: "DIRECTOR" });
    it("'all' needs every member, and one rejection rejects", () => {
      expect(advance([M(1, "APPROVED"), M(2, "APPROVED"), M(3, "PENDING"), authority], "all").newlyPending).toEqual([]);
      const done = advance([M(1, "APPROVED"), M(2, "APPROVED"), M(3, "APPROVED"), authority], "all");
      expect(done.newlyPending).toEqual([9]);
      expect(advance([M(1, "APPROVED"), M(2, "REJECTED"), M(3, "PENDING"), authority], "all").status).toBe("REJECTED");
    });
    it("'majority' needs more than half, then skips the rest", () => {
      expect(votesNeeded(4, "majority")).toBe(3);
      expect(votesNeeded(5, "majority")).toBe(3);
      const r = advance([M(1, "APPROVED"), M(2, "APPROVED"), M(3, "PENDING"), M(4, "PENDING"), M(5, "APPROVED"), authority], "majority");
      expect(r.status).toBe("PENDING");
      expect(r.changes.get(3)).toBe("SKIPPED");
      expect(r.changes.get(4)).toBe("SKIPPED");
      expect(r.newlyPending).toEqual([9]);
    });
    it("'majority' tolerates a dissent until a majority is out of reach", () => {
      expect(advance([M(1, "REJECTED"), M(2, "PENDING"), M(3, "PENDING"), authority], "majority").status).toBe("PENDING");
      expect(advance([M(1, "REJECTED"), M(2, "REJECTED"), M(3, "PENDING"), authority], "majority").status).toBe("REJECTED");
    });
    it("quorum doesn't apply to policy steps", () => {
      expect(advance([S(1, 1, "APPROVED"), S(2, 1, "PENDING", { approverRole: "DIRECTOR" })], "majority").status).toBe("PENDING");
    });
  });
});

describe("canDecide", () => {
  const ctx = { entity: "PO" as const, requestStatus: "PENDING" as const, requestedById: 10 };
  it("lets a holder of the step's role decide", () => {
    expect(canDecide(S(1, 1, "PENDING"), { id: 20, role: "FINANCE" }, ctx).ok).toBe(true);
    expect(canDecide(S(1, 1, "PENDING"), { id: 20, role: "ADMIN" }, ctx).ok).toBe(false); // admins aren't approvers by default
  });
  it("only opens pending steps of pending requests", () => {
    expect(canDecide(S(1, 1, "WAITING"), { id: 20, role: "FINANCE" }, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't open/) });
    expect(canDecide(S(1, 1, "APPROVED"), { id: 20, role: "FINANCE" }, ctx).ok).toBe(false);
    expect(canDecide(S(1, 1, "PENDING"), { id: 20, role: "FINANCE" }, { ...ctx, requestStatus: "CANCELLED" }).ok).toBe(false);
  });
  it("segregation: the requester can't approve their own request", () => {
    expect(canDecide(S(1, 1, "PENDING"), { id: 10, role: "FINANCE" }, ctx)).toMatchObject({ ok: false, reason: expect.stringMatching(/submitted/) });
  });
  it("segregation: one person can't approve two steps of the same request", () => {
    const steps = [S(1, 1, "APPROVED", { decidedById: 20 }), S(2, 2, "PENDING")];
    expect(canDecide(steps[1], { id: 20, role: "FINANCE" }, { ...ctx, steps }).ok).toBe(false);
    expect(canDecide(steps[1], { id: 21, role: "FINANCE" }, { ...ctx, steps }).ok).toBe(true);
  });
  it("named committee members sign their own step, even if they recorded the recommendation", () => {
    const awardCtx = { entity: "AWARD" as const, requestStatus: "PENDING" as const, requestedById: 3, chairUserIds: [3] };
    expect(canDecide(M(1, "PENDING", 3), { id: 3, role: "PROCUREMENT" }, awardCtx).ok).toBe(true);
    expect(canDecide(M(1, "PENDING", 3), { id: 4, role: "PROCUREMENT" }, awardCtx).ok).toBe(false);
    expect(canDecide(M(1, "PENDING", null), { id: 4, role: "PROCUREMENT" }, awardCtx)).toMatchObject({ ok: false, reason: expect.stringMatching(/records their signature/) });
  });
  it("Law 182 art. 28: the committee chair can't approve the award as competent authority", () => {
    const step = S(9, 2, "PENDING", { approverRole: "DIRECTOR" });
    const awardCtx = { entity: "AWARD" as const, requestStatus: "PENDING" as const, requestedById: 3, chairUserIds: [2] };
    expect(canDecide(step, { id: 2, role: "DIRECTOR" }, awardCtx)).toMatchObject({ ok: false, reason: expect.stringMatching(/art\. 28/) });
    expect(canDecide(step, { id: 5, role: "DIRECTOR" }, awardCtx).ok).toBe(true);
  });
  it("no committee member, not only the chair, can approve the award as competent authority", () => {
    const steps = [M(1, "APPROVED", 7), S(9, 2, "PENDING", { approverRole: "DIRECTOR" })];
    const awardCtx = { entity: "AWARD" as const, requestStatus: "PENDING" as const, requestedById: 3, chairUserIds: [2], steps };
    expect(canDecide(steps[1], { id: 7, role: "DIRECTOR" }, awardCtx)).toMatchObject({ ok: false, reason: expect.stringMatching(/outside it/) });
    expect(canDecide(steps[1], { id: 8, role: "DIRECTOR" }, awardCtx).ok).toBe(true);
  });
});

describe("canRecordPaper", () => {
  it("is for external members' pending steps, by procurement", () => {
    expect(canRecordPaper(M(1, "PENDING", null), { id: 3, role: "PROCUREMENT" }, "PENDING").ok).toBe(true);
    expect(canRecordPaper(M(1, "PENDING", null), { id: 3, role: "FINANCE" }, "PENDING").ok).toBe(false);
    expect(canRecordPaper(M(1, "PENDING", 7), { id: 3, role: "PROCUREMENT" }, "PENDING").ok).toBe(false);
    expect(canRecordPaper(M(1, "WAITING", null), { id: 3, role: "PROCUREMENT" }, "PENDING").ok).toBe(false);
    expect(canRecordPaper(S(1, 1, "PENDING"), { id: 3, role: "PROCUREMENT" }, "PENDING").ok).toBe(false);
  });
});

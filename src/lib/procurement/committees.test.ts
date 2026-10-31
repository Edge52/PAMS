import { describe, expect, it } from "vitest";
import { awardTimeline, committeeWarnings, requiredCommittees, signingMembers, type CommitteeInput } from "./committees";

const T = { singleCommitteeMaxEgp: 300_000, mofRepFromEgp: 1_000_000, stateCouncilFromEgp: 2_000_000 };
const m = (capacity: CommitteeInput["members"][number]["capacity"], over: Partial<CommitteeInput["members"][number]> = {}) =>
  ({ capacity, votes: capacity !== "SECRETARY", userId: 1, userRole: "PROCUREMENT", name: capacity.toLowerCase(), ...over });
const full = [m("CHAIR"), m("TECHNICAL"), m("FINANCIAL"), m("LEGAL")];
const texts = (w: ReturnType<typeof committeeWarnings>) => w.map((x) => `${x.level}:${x.article}:${x.text}`);

describe("requiredCommittees", () => {
  it("applies the thresholds (combined ≤ max, representatives strictly above)", () => {
    expect(requiredCommittees(300_000, T)).toEqual({ combinedAllowed: true, mofRep: false, stateCouncil: false });
    expect(requiredCommittees(300_001, T).combinedAllowed).toBe(false);
    expect(requiredCommittees(1_000_000, T).mofRep).toBe(false);
    expect(requiredCommittees(1_000_001, T)).toEqual({ combinedAllowed: false, mofRep: true, stateCouncil: false });
    expect(requiredCommittees(2_000_001, T).stateCouncil).toBe(true);
    expect(requiredCommittees(null, T)).toEqual({ combinedAllowed: false, mofRep: false, stateCouncil: false });
  });
});

describe("committeeWarnings", () => {
  it("asks for committees when none exist", () => {
    expect(texts(committeeWarnings(500_000, [], T))).toEqual([expect.stringMatching(/^warn:Art\. 28:No committees formed/)]);
    expect(texts(committeeWarnings(100_000, [], T))[0]).toMatch(/combined committee is enough/);
  });
  it("a complete small combined committee is clean", () => {
    expect(committeeWarnings(250_000, [{ id: 1, kind: "COMBINED", members: full }], T)).toEqual([]);
  });
  it("rejects a combined committee above the limit", () => {
    const w = committeeWarnings(400_000, [{ id: 1, kind: "COMBINED", members: full }], T);
    expect(w).toEqual([expect.objectContaining({ level: "error", article: "Art. 28", text: expect.stringMatching(/only allowed up to EGP 300,000/) })]);
  });
  it("needs both opening and adjudication committees otherwise", () => {
    expect(texts(committeeWarnings(500_000, [{ id: 1, kind: "ADJUDICATION", members: full }], T))).toEqual([expect.stringMatching(/No envelope-opening committee/)]);
  });
  it("requires Ministry of Finance and State Council representatives by value (art. 29)", () => {
    const w = committeeWarnings(2_500_000, [{ id: 1, kind: "OPENING", members: full }, { id: 2, kind: "ADJUDICATION", members: [...full, m("MOF_REP", { userId: null })] }], T);
    const errors = w.filter((x) => x.level === "error");
    expect(errors.map((e) => [e.committeeId, e.text.split(":")[1].trim().slice(0, 22)])).toEqual([
      [1, "a Ministry of Finance r"], [1, "a State Council (Fatwa "], [2, "a State Council (Fatwa "],
    ].map(([id, t]) => [id, (t as string).slice(0, 22)]));
  });
  it("flags missing technical/financial/legal members, chairs and empty committees", () => {
    const w = committeeWarnings(200_000, [{ id: 1, kind: "COMBINED", members: [m("MEMBER"), m("SECRETARY")] }], T);
    expect(texts(w)).toEqual([
      expect.stringMatching(/no chair named/),
      expect.stringMatching(/no technical member, financial member, legal member/),
    ]);
    const empty = committeeWarnings(200_000, [{ id: 1, kind: "COMBINED", members: [m("SECRETARY")] }], T);
    expect(empty).toEqual([expect.objectContaining({ level: "error", text: expect.stringMatching(/add the members/) })]);
  });
  it("warns when a director chairs (art. 28)", () => {
    const w = committeeWarnings(200_000, [{ id: 1, kind: "COMBINED", members: [m("CHAIR", { userRole: "DIRECTOR", name: "Dr. Hala" }), ...full.slice(1)] }], T);
    expect(texts(w)).toEqual([expect.stringMatching(/chair \(Dr\. Hala\) is a director/)]);
  });
  it("can't check thresholds without a value", () => {
    expect(texts(committeeWarnings(null, [{ id: 1, kind: "COMBINED", members: full }], T))[0]).toMatch(/No estimated value/);
  });
});

describe("awardTimeline and signing members", () => {
  it("adds the complaint window and the acceptance notice (art. 39)", () => {
    expect(awardTimeline("2026-10-28", 7, 2)).toEqual({ complaintUntil: "2026-11-04", acceptanceDue: "2026-11-06" });
    expect(awardTimeline("2026-12-28", 7, 2)).toEqual({ complaintUntil: "2027-01-04", acceptanceDue: "2027-01-06" });
  });
  it("secretaries don't sign", () => {
    expect(signingMembers([m("CHAIR"), m("SECRETARY"), m("LEGAL")]).map((x) => x.capacity)).toEqual(["CHAIR", "LEGAL"]);
  });
});

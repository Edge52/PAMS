import { describe, expect, it } from "vitest";
import { riskLevel, riskProblems, riskScore, riskSummary, type RiskEntry } from "./network-risk";
import { extraConcerns, legacyFacts, monthsSince, type SecurityExtras } from "./device-security";
import { replacementScore } from "./lifecycle-kpis";

const today = "2026-11-27";
const entry = (o: Partial<RiskEntry> = {}): RiskEntry => ({ connectsTo: "PACS", hazard: "Images sent to the wrong patient", likelihood: 3, severity: 4, controls: "DICOM worklist, VLAN",
  residualLikelihood: 2, residualSeverity: 4, owner: "IT security", reviewDue: "2027-06-01", status: "OPEN", ...o });

describe("network risk per connection (wave 41)", () => {
  it("scores on the 5 × 5 matrix", () => {
    expect(riskScore(3, 4)).toBe(12);
    expect(riskLevel(4)).toBe("low");
    expect(riskLevel(12)).toBe("medium");
    expect(riskLevel(15)).toBe("high");
  });
  it("checks an entry", () => {
    expect(riskProblems(entry(), today)).toEqual({});
    expect(riskProblems(entry({ residualLikelihood: 5 }), today).residualLikelihood).toMatch(/higher/);
    expect(riskProblems(entry({ controls: "" }), today).controls).toMatch(/controls/);
    expect(riskProblems(entry({ status: "ACCEPTED", owner: "" }), today).owner).toMatch(/owner/);
    expect(riskProblems(entry({ reviewDue: "2026-01-01" }), today).reviewDue).toMatch(/past/);
    expect(riskProblems(entry({ likelihood: 6 }), today).likelihood).toMatch(/1 to 5/);
    expect(riskProblems(entry({ hazard: " " }), today).hazard).toBeTruthy();
  });
  it("sums up a device's risks, leaving out closed ones", () => {
    const list = [entry({ residualLikelihood: 4, residualSeverity: 4, likelihood: 4, severity: 5 }), entry({ reviewDue: "2026-10-01" }), entry({ status: "CLOSED", reviewDue: "2020-01-01" })];
    expect(riskSummary(list, today)).toEqual({ risks: 2, highResidual: 1, reviewOverdue: 1 });
  });
});

describe("security extras", () => {
  const base: SecurityExtras = { sbomOnFile: true, unsupportedComponents: [], remoteAgreement: { onFile: true, expiresOn: "2027-12-31" }, highResidual: 0, reviewOverdue: 0, risks: 1 };
  it("has nothing to say about a device off the network", () => {
    expect(extraConcerns({ connection: "NONE", remoteAccess: "SUPPLIER" }, { ...base, sbomOnFile: false, risks: 0 }, today)).toEqual([]);
  });
  it("asks for the supplier's remote-access agreement and flags it expired or expiring", () => {
    const on = { connection: "WIRED" as const, remoteAccess: "SUPPLIER" as const };
    expect(extraConcerns(on, base, today)).toEqual([]);
    expect(extraConcerns(on, { ...base, remoteAgreement: { onFile: false, expiresOn: null } }, today)[0]).toMatchObject({ level: "high", text: expect.stringMatching(/no remote-access agreement/) });
    expect(extraConcerns(on, { ...base, remoteAgreement: { onFile: true, expiresOn: "2026-11-01" } }, today)[0].text).toMatch(/expired/);
    expect(extraConcerns(on, { ...base, remoteAgreement: { onFile: true, expiresOn: "2026-12-20" } }, today)[0]).toMatchObject({ level: "medium" });
    expect(extraConcerns({ ...on, remoteAccess: "HOSPITAL" }, { ...base, remoteAgreement: { onFile: false, expiresOn: null } }, today)).toEqual([]);
  });
  it("lists risks, SBOM and unsupported components", () => {
    const t = extraConcerns({ connection: "WIRELESS", remoteAccess: "NONE" }, { ...base, sbomOnFile: false, risks: 0, unsupportedComponents: ["OpenSSL 1.0.2"], highResidual: 0 }, today).map((c) => c.text);
    expect(t.join(" | ")).toMatch(/No network risk.*SBOM.*OpenSSL 1.0.2/);
  });
});

describe("legacy devices in the replacement score (ECRI 2026 #8)", () => {
  it("counts months since the last update", () => {
    expect(monthsSince("2025-11-27", today)).toBe(12);
    expect(monthsSince("2025-11-28", today)).toBe(11);
    expect(monthsSince("2027-01-01", today)).toBe(0);
  });
  it("only counts devices on the network", () => {
    expect(legacyFacts({ connection: "NONE", osSupportEnds: "2020-01-14", lastPatchedOn: null }, today)).toEqual({ osUnsupported: false, monthsWithoutPatch: null });
    expect(legacyFacts({ connection: "WIRED", osSupportEnds: "2020-01-14", lastPatchedOn: "2024-05-01" }, today)).toEqual({ osUnsupported: true, monthsWithoutPatch: 30 });
    expect(legacyFacts(null, today)).toEqual({ osUnsupported: false, monthsWithoutPatch: null });
  });
  it("raises the score and says why", () => {
    const base = { lifeUsedPct: 50, repairCostRatio: 0, failures12m: 0, downtimeHours12m: 0, criticality: "MEDIUM", condition: "GOOD", openRecall: false };
    const plain = replacementScore(base), legacy = replacementScore({ ...base, osUnsupported: true, monthsWithoutPatch: 30 });
    expect(legacy.score - plain.score).toBe(15);
    expect(legacy.reasons).toEqual(expect.arrayContaining(["Its operating system no longer gets security fixes", "No security update for 30 months"]));
    expect(replacementScore({ ...base, monthsWithoutPatch: 13 }).score - plain.score).toBe(3);
    expect(replacementScore({ ...base, monthsWithoutPatch: 6 }).score).toBe(plain.score);
  });
});

import { describe, expect, it } from "vitest";
import { checkState, doseFlag, isRadiationType, latestBy, licenceState, nextCheckDue, periodLimit, roomStatus } from "./radiation";

const today = "2026-11-22";

describe("radiation device types", () => {
  it("covers X-ray, CT, C-arm, mammography, angiography, nuclear medicine, DXA, dental X-ray and radiotherapy", () => {
    for (const c of ["IMG-CT-64", "IMG-XR-DR", "IMG-XR-CARM", "IMG-XR-MDR", "IMG-MAM-DIG", "IMG-ANG-SP", "IMG-NM-PETCT", "IMG-BMD-DXA", "IMG-DEN-OPG", "RTH-EBT-LINAC", "img-xr-fluoro"]) expect(isRadiationType(c)).toBe(true);
  });
  it("leaves out MRI, ultrasound and non-emitting items", () => {
    for (const c of ["IMG-MRI-15T", "IMG-US-GEN", "IMG-MAM-ABUS", "IMG-DEN-SENS", "IMG-BMD-QUS", "IMG-RPR-APR", "MON-PAT-HIGH", "IMG-CTX", null]) expect(isRadiationType(c)).toBe(false);
  });
});

describe("licence expiry", () => {
  it("expired, inside 90 days, or valid", () => {
    expect(licenceState("2026-11-21", today)).toBe("expired");
    expect(licenceState(today, today)).toBe("expiring");
    expect(licenceState("2027-02-20", today)).toBe("expiring"); // 90 days
    expect(licenceState("2027-02-21", today)).toBe("ok");
  });
});

describe("QC and protective checks", () => {
  it("reads the latest record", () => {
    expect(checkState(null, today)).toBe("none");
    expect(checkState({ result: "FAIL", nextDue: null }, today)).toBe("failed");
    expect(checkState({ result: "PASS", nextDue: "2026-11-01" }, today)).toBe("overdue");
    expect(checkState({ result: "PASS", nextDue: "2026-12-22" }, today)).toBe("soon");
    expect(checkState({ result: "PASS", nextDue: "2027-06-01" }, today)).toBe("ok");
  });
  it("next due only after a pass", () => {
    expect(nextCheckDue("2026-02-28", 12, "PASS")).toBe("2027-02-28");
    expect(nextCheckDue("2026-02-28", 6, "FAIL")).toBeNull();
  });
  it("latest per key", () => {
    const m = latestBy([{ id: 1, k: "a", d: "2026-01-01" }, { id: 2, k: "a", d: "2026-05-01" }, { id: 3, k: "a", d: "2026-05-01" }, { id: 4, k: "b", d: "2025-01-01" }], (r) => r.k, (r) => r.d);
    expect(m.get("a")?.id).toBe(3);
    expect(m.get("b")?.id).toBe(4);
  });
});

describe("dosimetry", () => {
  it("pro-rates the annual 20 mSv limit to the badge period", () => {
    expect(periodLimit("2026-01-01", "2026-12-31")).toBe(20);
    expect(periodLimit("2026-01-01", "2026-03-31")).toBe(4.93);
    expect(periodLimit("2026-10-01", "2026-10-31")).toBe(1.7);
  });
  it("flags readings over the limit or at the investigation level", () => {
    expect(doseFlag(0.1, 1.7)).toBe("OK");
    expect(doseFlag(0.51, 1.7)).toBe("INVESTIGATE");
    expect(doseFlag(1.7, 1.7)).toBe("INVESTIGATE");
    expect(doseFlag(1.71, 1.7)).toBe("OVER");
  });
});

describe("room status", () => {
  it("a room with radiation devices needs a valid licence and QC", () => {
    expect(roomStatus({ licences: [], qc: ["ok"], protective: [], radiationDevices: 1 })).toEqual({ state: "problem", reasons: ["No ENRRA licence on record"] });
    expect(roomStatus({ licences: ["expired"], qc: ["ok"], protective: [], radiationDevices: 1 }).reasons).toEqual(["Licence expired"]);
    expect(roomStatus({ licences: ["ok"], qc: [], protective: [], radiationDevices: 1 }).reasons).toEqual(["No physicist QC on record"]);
  });
  it("problems, then things due soon, then fine", () => {
    expect(roomStatus({ licences: ["ok"], qc: ["overdue", "failed"], protective: ["failed"], radiationDevices: 1 }).reasons).toEqual(["2 QC tests failed or overdue", "1 protective item failed or overdue"]);
    expect(roomStatus({ licences: ["expiring"], qc: ["soon"], protective: [], radiationDevices: 1 })).toEqual({ state: "attention", reasons: ["2 items due soon"] });
    expect(roomStatus({ licences: ["ok"], qc: ["ok"], protective: ["ok"], radiationDevices: 2 })).toEqual({ state: "ok", reasons: [] });
  });
});

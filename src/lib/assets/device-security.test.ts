import { describe, expect, it } from "vitest";
import { addressProblem, concerns, tidyMac, worst, type SecurityRecord } from "./device-security";

const good: SecurityRecord = {
  connection: "WIRED", operatingSystem: "Windows 11 IoT", osSupportEnds: "2031-01-01", storesPatientData: "YES", sendsPatientData: "YES",
  encrypted: "YES", antiMalware: "YES", defaultPasswordsChanged: "YES", remoteAccess: "SUPPLIER", lastPatchedOn: "2026-09-01", mds2OnFile: true, reviewedOn: "2026-06-01",
};
const TODAY = "2026-11-16";

describe("device security concerns (wave 25)", () => {
  it("has none for a well-kept device", () => {
    expect(concerns(good, TODAY)).toEqual([]);
    expect(worst(concerns(good, TODAY))).toBe("none");
  });
  it("has none for a device off the network with no patient data, whatever else is blank", () => {
    expect(concerns({ ...good, connection: "NONE", storesPatientData: "NO", sendsPatientData: "NO", mds2OnFile: false, reviewedOn: null, lastPatchedOn: null }, TODAY)).toEqual([]);
  });
  it("puts the serious ones first", () => {
    const c = concerns({ ...good, osSupportEnds: "2025-10-14", defaultPasswordsChanged: "NO", encrypted: "NO", antiMalware: "NO", mds2OnFile: false }, TODAY);
    expect(c.slice(0, 3).every((x) => x.level === "high")).toBe(true);
    expect(c.map((x) => x.text)).toContain("The operating system no longer gets security fixes.");
    expect(c.map((x) => x.text)).toContain("Still has the factory passwords.");
    expect(c.map((x) => x.text)).toContain("Holds patient data that isn't encrypted.");
    expect(worst(c)).toBe("high");
  });
  it("flags old patches, support ending soon, and stale reviews", () => {
    const t = (r: Partial<SecurityRecord>) => concerns({ ...good, ...r }, TODAY).map((x) => x.text);
    expect(t({ lastPatchedOn: "2025-10-01" })).toEqual(["No security update in over a year."]);
    expect(t({ lastPatchedOn: null })).toEqual(["No security update on record."]);
    expect(t({ osSupportEnds: "2027-03-01" })).toEqual(["Operating system support ends within a year."]);
    expect(t({ reviewedOn: null })).toEqual(["Never reviewed."]);
    expect(t({ defaultPasswordsChanged: "UNKNOWN" })).toEqual(["The supplier can connect from outside and the passwords aren't confirmed changed."]);
  });
  it("an offline device with patient data is still checked for encryption and paperwork", () => {
    const c = concerns({ ...good, connection: "NONE", encrypted: "NO", lastPatchedOn: null, mds2OnFile: false }, TODAY).map((x) => x.text);
    expect(c).toEqual(["Holds patient data that isn't encrypted.", "The manufacturer's security statement (MDS2) isn't on file."]);
  });
  it("checks typed addresses", () => {
    expect(addressProblem("10.20.4.17", "00:1a:2b:3c:4d:5e")).toBeNull();
    expect(addressProblem("fe80::1", null)).toBeNull();
    expect(addressProblem("10.20.4.300", "001A2B3C4D5E")).toEqual({ ipAddress: expect.any(String), macAddress: expect.any(String) });
    expect(tidyMac("00-1a-2b-3c-4d-5e")).toBe("00:1A:2B:3C:4D:5E");
  });
});

import { describe, expect, it } from "vitest";
import { checkContract, checkPart, checkPpm, checkSupplier, checkUser, runChecks, splitList } from "./kinds";

describe("supplier rows (wave 41)", () => {
  it("reads a row and refuses duplicates", () => {
    const seen = new Set<string>();
    const r = checkSupplier({ name: "Nile Medical", type: "Service provider", brands: "Philips, GE", email: "a@b.eg" }, new Set(["al-amal"]), seen);
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ name: "Nile Medical", type: "SERVICE_PROVIDER", brands: ["Philips", "GE"] });
    expect(checkSupplier({ name: "nile  medical" }, new Set(), seen).errors[0]).toMatch(/twice/);
    expect(checkSupplier({ name: "Al-Amal" }, new Set(["al-amal"]), new Set()).errors[0]).toMatch(/already/);
    expect(checkSupplier({ name: "X", email: "nope", type: "Gold" }, new Set(), new Set()).errors).toEqual([expect.stringMatching(/^Type/), "Email is not a valid address."]);
    expect(checkSupplier({}, new Set(), new Set()).errors).toEqual(["Supplier name is required."]);
  });
});

describe("service contract rows", () => {
  const lk = { suppliers: new Map([["nile medical", 7]]), assets: new Map([["DGH-CT-000001", 11]]), prices: true };
  it("reads terms, dates and covered devices", () => {
    const r = checkContract({ supplier: "Nile Medical", title: "CT", startDate: "2027-01-01", endDate: "31/12/2027", value: "450,000", responseHours: 4, uptimePct: 95, includesParts: "yes", assetTags: "dgh-ct-000001" }, lk);
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ supplierId: 7, endDate: "2027-12-31", value: 450000, currency: "EGP", includesParts: true, assetIds: [11], type: "FULL_SERVICE" });
  });
  it("leaves the value out for people who may not see prices", () => {
    const r = checkContract({ supplier: "Nile Medical", title: "CT", startDate: "2027-01-01", endDate: "2027-12-31", value: 10 }, { ...lk, prices: false });
    expect(r.value?.value).toBeNull();
    expect(r.warnings[0]).toMatch(/prices/);
  });
  it("says what is wrong", () => {
    const r = checkContract({ supplier: "Unknown", title: "", startDate: "2027-06-01", endDate: "2027-01-01", uptimePct: 120, assetTags: "DGH-X-1" }, lk);
    expect(r.errors).toEqual([expect.stringMatching(/Unknown/), "Title is required.", "The end date is before the start date.", "No device DGH-X-1 in this hospital.", "Uptime % must be at most 100."]);
  });
});

describe("user rows", () => {
  const lk = { emails: new Set(["old@h.eg"]), facilities: new Map([["DGH", 1], ["LPH", 2]]) };
  it("reads role by name and hospitals by code, without a password", () => {
    const r = checkUser({ name: "Mona", email: "Mona@H.eg", role: "Biomedical engineer", hospitals: "dgh, LPH" }, lk, new Set());
    expect(r.value).toEqual({ name: "Mona", email: "mona@h.eg", role: "BIOMEDICAL", jobTitle: null, phone: null, facilityIds: [1, 2] });
    expect(checkUser({ name: "A", email: "a@h.eg", role: "Administrator", hospitals: "DGH" }, lk, new Set()).value?.facilityIds).toBeNull();
  });
  it("refuses taken emails, unknown roles and hospitals", () => {
    expect(checkUser({ name: "O", email: "old@h.eg", role: "Viewer" }, lk, new Set()).errors[0]).toMatch(/already/);
    expect(checkUser({ name: "O", email: "n@h.eg", role: "Boss" }, lk, new Set()).errors[0]).toMatch(/^Role must be one of/);
    expect(checkUser({ name: "O", email: "n@h.eg" }, lk, new Set()).errors).toEqual(["Role is required."]);
    expect(checkUser({ name: "O", email: "n@h.eg", role: "Viewer", hospitals: "XYZ" }, lk, new Set()).errors).toEqual(["No hospital with the code XYZ."]);
  });
});

describe("PPM schedule rows", () => {
  const lk = { assets: new Map([["DGH-MON-000042", { id: 42, disposed: false }], ["DGH-MON-000043", { id: 43, disposed: true }]]), suppliers: new Map([["nile medical", 7]]), existing: new Set(["42|PPM|2027-03-01"]) };
  it("reads a visit and warns about a date in the past", () => {
    const r = checkPpm({ assetTag: "dgh-mon-000042", type: "Safety test", scheduledDate: "2026-01-10", vendor: "Nile Medical" }, lk, new Set(), "2026-11-27");
    expect(r.value).toEqual({ assetId: 42, type: "SAFETY_TEST", scheduledDate: "2026-01-10", vendorId: 7, notes: null });
    expect(r.warnings[0]).toMatch(/overdue/);
  });
  it("refuses disposed devices and visits already planned or repeated", () => {
    expect(checkPpm({ assetTag: "DGH-MON-000043", scheduledDate: "2027-01-01" }, lk, new Set(), "2026-11-27").errors[0]).toMatch(/disposed/);
    expect(checkPpm({ assetTag: "DGH-MON-000042", scheduledDate: "2027-03-01" }, lk, new Set(), "2026-11-27").errors[0]).toMatch(/already scheduled/);
    const seen = new Set<string>();
    checkPpm({ assetTag: "DGH-MON-000042", scheduledDate: "2027-04-01" }, lk, seen, "2026-11-27");
    expect(checkPpm({ assetTag: "DGH-MON-000042", scheduledDate: "2027-04-01" }, lk, seen, "2026-11-27").errors[0]).toMatch(/twice/);
  });
});

describe("spare part rows", () => {
  const lk = { existing: new Set(["M1191B"]), deviceTypes: new Map([["MON-PAT-HIGH", 5]]), suppliers: new Map<string, number>(), prices: false };
  it("reads stock and leaves the cost out without price access", () => {
    const r = checkPart({ partNumber: "989803", name: "ECG cable", deviceTypeCode: "mon-pat-high", unitCost: 100, stockQty: 6, minQty: 2 }, lk, new Set());
    expect(r.value).toMatchObject({ deviceTypeId: 5, unitCost: null, currency: null, stockQty: 6, minQty: 2 });
    expect(r.warnings).toHaveLength(1);
  });
  it("refuses an existing part number and bad counts", () => {
    expect(checkPart({ partNumber: "m1191b", name: "X" }, lk, new Set()).errors[0]).toMatch(/already/);
    expect(checkPart({ partNumber: "A", name: "X", stockQty: 1.5, supplier: "Nobody" }, lk, new Set()).errors).toEqual([expect.stringMatching(/Nobody/), "In stock must be a whole number."]);
  });
});

describe("helpers", () => {
  it("splits lists and runs checks with shown values", () => {
    expect(splitList("a, b;c\nd")).toEqual(["a", "b", "c", "d"]);
    const rows = runChecks([{ rowNumber: 2, cells: { name: "A", when: new Date("2026-01-02T00:00:00Z") } }], () => ({ value: 1, errors: [] }));
    expect(rows[0]).toMatchObject({ rowNumber: 2, value: 1, values: { name: "A", when: "2026-01-02" }, warnings: [] });
  });
});

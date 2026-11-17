import { describe, expect, it } from "vitest";
import { supplierDocAlerts } from "../notifications/alert-rules";
import { docExpiry, docReminderDue, docReminderKey, expiredWarning, expiringList, expiryText } from "./supplier-docs";

const today = "2026-11-17";

describe("supplier document expiry", () => {
  it("classifies by days to expiry", () => {
    expect(docExpiry(null, today)).toEqual({ state: "NONE", days: null });
    expect(docExpiry("2026-11-16", today)).toEqual({ state: "EXPIRED", days: -1 });
    expect(docExpiry("2026-11-17", today)).toEqual({ state: "EXPIRING", days: 0 }); // valid on its last day
    expect(docExpiry("2027-01-16", today)).toEqual({ state: "EXPIRING", days: 60 });
    expect(docExpiry("2027-01-17", today)).toEqual({ state: "VALID", days: 61 });
    expect(docExpiry("not a date", today).state).toBe("NONE");
  });
  it("says it in words", () => {
    expect(expiryText(docExpiry("2026-11-16", today), "16 Nov 2026")).toBe("Expired yesterday (16 Nov 2026)");
    expect(expiryText(docExpiry("2026-11-17", today), "17 Nov 2026")).toBe("Expires today (17 Nov 2026)");
    expect(expiryText(docExpiry("2026-11-27", today), "27 Nov 2026")).toBe("Expires in 10 days (27 Nov 2026)");
    expect(expiryText(docExpiry("2028-01-01", today), "1 Jan 2028")).toBe("Valid until 1 Jan 2028");
  });
  it("lists expired and expiring documents, soonest first", () => {
    const docs = [
      { id: 1, supplierId: 1, kind: "iso_13485", fileName: "a.pdf", expiresOn: "2027-06-01" },
      { id: 2, supplierId: 1, kind: "eda_registration", fileName: "b.pdf", expiresOn: "2026-12-20" },
      { id: 3, supplierId: 2, kind: "licence", fileName: "c.pdf", expiresOn: "2026-10-01" },
      { id: 4, supplierId: 2, kind: "tax_card", fileName: "d.pdf", expiresOn: null },
    ];
    expect(expiringList(docs, today).map((d) => d.id)).toEqual([3, 2]);
    expect(expiredWarning("Acme", docs, today)).toMatch(/^Acme has an expired document on file: Licence\. .*warning only/);
    expect(expiredWarning("Acme", docs.slice(0, 2), today)).toBeNull();
  });
});

describe("expiry reminder", () => {
  it("is due once inside 30 days and not after expiry", () => {
    expect(docReminderDue("2026-12-17", today)).toBe(true); // 30 days
    expect(docReminderDue("2026-12-18", today)).toBe(false); // 31 days
    expect(docReminderDue("2026-11-10", today)).toBe(false); // expired
    expect(docReminderKey(9, "2026-12-17")).toBe("supplier_doc_expiring:9:2026-12-17");
  });
  it("goes to procurement with a key per document and date", () => {
    const a = supplierDocAlerts([
      { id: 9, supplierId: 4, supplierName: "Nile Medical", kind: "eda_registration", fileName: "eda.pdf", expiresOn: "2026-12-01" },
      { id: 10, supplierId: 4, supplierName: "Nile Medical", kind: "iso_13485", fileName: "iso.pdf", expiresOn: "2027-05-01" },
    ], today);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ role: "PROCUREMENT", facilityId: null });
    expect(a[0].n).toMatchObject({ kind: "supplier_doc_expiring", href: "/procurement/suppliers/4", dedupeKey: "supplier_doc_expiring:9:2026-12-01" });
    expect(a[0].n.title).toBe("Nile Medical: EDA registration expires in 14 days");
  });
});

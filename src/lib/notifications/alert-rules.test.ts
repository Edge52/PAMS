import { describe, expect, it } from "vitest";
import {
  digestAlerts, isoWeek,
  acceptanceNoticeAlerts, collectAlerts, contractAlerts, latePoAlerts, maintenanceAlerts, offerExpiryAlerts, rfqClosingAlerts, warrantyAlerts,
  type AlertData,
} from "./alert-rules";
import { absoluteLink, notificationEmail, safeHref } from "./types";

const today = "2026-10-29";

const offer = (o: Partial<Parameters<typeof offerExpiryAlerts>[0][number]> = {}) => ({
  id: 1, reference: "Q-1", status: "UNDER_REVIEW", validUntil: "2026-11-05", supplierName: "Delta", projectCode: "T-1", facilityId: 1, ...o,
});

describe("offer expiry alerts", () => {
  it("warns inside the window and not outside it", () => {
    expect(offerExpiryAlerts([offer({ validUntil: "2026-11-12" })], today, 14)).toHaveLength(1); // 14 days
    expect(offerExpiryAlerts([offer({ validUntil: "2026-11-13" })], today, 14)).toHaveLength(0); // 15 days
    expect(offerExpiryAlerts([offer({ validUntil: "2026-10-28" })], today, 14)).toHaveLength(0); // already expired
    expect(offerExpiryAlerts([offer({ validUntil: today })], today, 14)[0].n.title).toMatch(/expires today/);
  });
  it("skips awarded, rejected and withdrawn offers and offers without a validity date", () => {
    for (const status of ["AWARDED", "REJECTED", "WITHDRAWN"]) expect(offerExpiryAlerts([offer({ status })], today, 14)).toHaveLength(0);
    expect(offerExpiryAlerts([offer({ validUntil: null })], today, 14)).toHaveLength(0);
  });
  it("cites Law 182 art. 27 inside 15 days and uses a separate stage key", () => {
    const urgent = offerExpiryAlerts([offer({ validUntil: "2026-11-10" })], today, 30)[0];
    const early = offerExpiryAlerts([offer({ validUntil: "2026-11-20" })], today, 30)[0];
    expect(urgent.n.body).toMatch(/art\. 27/);
    expect(urgent.n.body).toMatch(/inside that window/);
    expect(urgent.n.dedupeKey).toBe("offer_expiring:1:2026-11-10:art27");
    expect(early.n.dedupeKey).toBe("offer_expiring:1:2026-11-20:warn");
    expect(early.n.body).not.toMatch(/inside that window/);
  });
  it("goes to procurement, facility-aware, with a link to the offer", () => {
    const [a] = offerExpiryAlerts([offer({ id: 7, facilityId: 3 })], today, 14);
    expect(a.role).toBe("PROCUREMENT");
    expect(a.facilityId).toBe(3);
    expect(a.n.href).toBe("/procurement/offers/7");
  });
});

describe("RFQ closing alerts", () => {
  const rfq = { id: 2, number: "RFQ-2026-0002", title: "CT", status: "ISSUED", closingDate: "2026-10-31", projectId: 1, facilityId: null };
  it("only issued RFQs inside the window", () => {
    expect(rfqClosingAlerts([rfq], today, 3)).toHaveLength(1);
    expect(rfqClosingAlerts([{ ...rfq, closingDate: "2026-11-01" }], today, 3)).toHaveLength(1);
    expect(rfqClosingAlerts([{ ...rfq, closingDate: "2026-11-02" }], today, 3)).toHaveLength(0);
    expect(rfqClosingAlerts([{ ...rfq, status: "DRAFT" }], today, 3)).toHaveLength(0);
    expect(rfqClosingAlerts([{ ...rfq, closingDate: "2026-10-28" }], today, 3)).toHaveLength(0);
  });
  it("re-alerts when the closing date moves", () => {
    const a = rfqClosingAlerts([rfq], today, 3)[0].n.dedupeKey;
    const b = rfqClosingAlerts([{ ...rfq, closingDate: "2026-10-30" }], today, 3)[0].n.dedupeKey;
    expect(a).not.toBe(b);
  });
});

describe("late purchase order alerts", () => {
  const po = { id: 4, number: "PO-2026-0004", status: "ISSUED", expectedDelivery: "2026-10-19", supplierName: "Acme", facilityId: 1 };
  it("counts days late and ignores finished or draft orders", () => {
    const [a] = latePoAlerts([po], today);
    expect(a.n.title).toMatch(/10 days late/);
    expect(latePoAlerts([{ ...po, expectedDelivery: today }], today)).toHaveLength(0);
    for (const status of ["DRAFT", "DELIVERED", "CLOSED", "CANCELLED"]) expect(latePoAlerts([{ ...po, status }], today)).toHaveLength(0);
    expect(latePoAlerts([{ ...po, status: "PARTIALLY_DELIVERED" }], today)).toHaveLength(1);
    expect(latePoAlerts([{ ...po, expectedDelivery: "2026-10-28" }], today)[0].n.title).toMatch(/1 day late/);
  });
});

describe("warranty alerts", () => {
  const asset = { id: 9, assetTag: "DGH-MON-000009", typeName: "Patient monitor", status: "IN_SERVICE", warrantyEnd: "2027-01-20", facilityId: 2, supplierName: "Delta", departmentName: "ICU" };
  it("biomedical, facility of the asset, inside the window only", () => {
    const [a] = warrantyAlerts([asset], today, 90);
    expect(a.role).toBe("BIOMEDICAL");
    expect(a.facilityId).toBe(2);
    expect(a.n.body).toMatch(/ICU/);
    expect(warrantyAlerts([{ ...asset, warrantyEnd: "2027-01-28" }], today, 90)).toHaveLength(0);
    expect(warrantyAlerts([{ ...asset, status: "DISPOSED" }], today, 90)).toHaveLength(0);
  });
});

describe("maintenance alerts", () => {
  const ev = { id: 11, assetId: 9, assetTag: "DGH-MON-000009", typeName: "Patient monitor", type: "PPM", status: "SCHEDULED", scheduledDate: "2026-11-02", assetStatus: "IN_SERVICE", facilityId: 1, departmentName: null };
  it("goes to biomedical and technicians", () => {
    const alerts = maintenanceAlerts([ev], today);
    expect(alerts.map((a) => a.role).sort()).toEqual(["BIOMEDICAL", "TECHNICIAN"]);
    expect(alerts[0].n.kind).toBe("maintenance_due");
  });
  it("splits due and overdue with different keys", () => {
    const [over] = maintenanceAlerts([{ ...ev, scheduledDate: "2026-10-20" }], today);
    expect(over.n.kind).toBe("maintenance_overdue");
    expect(over.n.title).toMatch(/PPM overdue/);
    expect(over.n.body).toMatch(/9 days ago/);
    expect(over.n.dedupeKey).toBe("maintenance_overdue:11");
  });
  it("ignores completed, cancelled, far-off work and disposed assets", () => {
    expect(maintenanceAlerts([{ ...ev, status: "COMPLETED" }], today)).toHaveLength(0);
    expect(maintenanceAlerts([{ ...ev, status: "CANCELLED" }], today)).toHaveLength(0);
    expect(maintenanceAlerts([{ ...ev, scheduledDate: "2026-11-05" }], today, 7)).toHaveLength(2);
    expect(maintenanceAlerts([{ ...ev, scheduledDate: "2026-11-06" }], today, 7)).toHaveLength(0);
    expect(maintenanceAlerts([{ ...ev, assetStatus: "DISPOSED" }], today)).toHaveLength(0);
  });
});

describe("acceptance notice alerts", () => {
  const award = { id: 2, reference: "Q-2", status: "AWARDED", complaintUntil: "2026-10-28", acceptanceDue: "2026-10-30", acceptedOn: null, supplierName: "Delta", projectCode: "T-1", facilityId: 1 };
  it("fires once the complaint window has ended and no acceptance is recorded", () => {
    const [a] = acceptanceNoticeAlerts([award], today);
    expect(a.n.kind).toBe("acceptance_notice_due");
    expect(a.n.body).toMatch(/art\. 39/);
    expect(acceptanceNoticeAlerts([{ ...award, complaintUntil: today }], today)).toHaveLength(0); // window runs through today
    expect(acceptanceNoticeAlerts([{ ...award, acceptedOn: "2026-10-29" }], today)).toHaveLength(0);
    expect(acceptanceNoticeAlerts([{ ...award, complaintUntil: null }], today)).toHaveLength(0);
    expect(acceptanceNoticeAlerts([{ ...award, status: "SHORTLISTED" }], today)).toHaveLength(0);
  });
  it("says when the acceptance date has already passed", () => {
    expect(acceptanceNoticeAlerts([{ ...award, acceptanceDue: "2026-10-28" }], today)[0].n.body).toMatch(/has passed/);
  });
});

describe("collectAlerts", () => {
  it("every alert has a dedupe key, a title and an in-app link; keys are stable across runs", () => {
    const data: AlertData = {
      offers: [offer()],
      rfqs: [{ id: 2, number: "RFQ-1", title: "x", status: "ISSUED", closingDate: "2026-10-30", projectId: 1, facilityId: 1 }],
      pos: [{ id: 3, number: "PO-1", status: "ISSUED", expectedDelivery: "2026-10-01", supplierName: "A", facilityId: 1 }],
      warranties: [{ id: 4, assetTag: "T", typeName: "x", status: "IN_SERVICE", warrantyEnd: "2026-12-01", facilityId: 1, supplierName: null, departmentName: null }],
      maintenance: [{ id: 5, assetId: 4, assetTag: "T", typeName: "x", type: "CALIBRATION", status: "OVERDUE", scheduledDate: "2026-10-01", assetStatus: "IN_SERVICE", facilityId: 1, departmentName: null }],
      awards: [{ id: 6, reference: "Q", status: "AWARDED", complaintUntil: "2026-10-01", acceptanceDue: null, acceptedOn: null, supplierName: "A", projectCode: "P", facilityId: 1 }],
    };
    const w = { offerExpiryWarnDays: 14, warrantyWarnDays: 90, rfqClosingWarnDays: 3, maintenanceDueDays: 7 };
    const a = collectAlerts(data, today, w);
    const b = collectAlerts(data, today, w);
    expect(a).toHaveLength(7);
    expect(a.map((x) => x.n.dedupeKey)).toEqual(b.map((x) => x.n.dedupeKey));
    for (const x of a) {
      expect(x.n.dedupeKey).toBeTruthy();
      expect(x.n.title.length).toBeGreaterThan(5);
      expect(safeHref(x.n.href)).toBe(x.n.href);
    }
    expect(a.find((x) => x.n.kind === "maintenance_overdue")?.n.title).toMatch(/Calibration overdue/);
  });
});

describe("links and email text", () => {
  it("only follows in-app paths", () => {
    expect(safeHref("/assets/1")).toBe("/assets/1");
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("https://evil.example")).toBeNull();
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/\\evil.example")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
  it("builds absolute email links from APP_URL", () => {
    expect(absoluteLink("https://pams.example/", "/assets/1")).toBe("https://pams.example/assets/1");
    expect(absoluteLink("https://pams.example", "//evil")).toBe("https://pams.example/notifications");
    expect(absoluteLink(null, "/assets/1")).toBeNull();
    const m = notificationEmail({ title: "PO late", body: "Chase it.", href: "/procurement/purchase-orders/3" }, "https://pams.example");
    expect(m.subject).toBe("[Hospital PAMS] PO late");
    expect(m.text).toContain("Chase it.");
    expect(m.text).toContain("https://pams.example/procurement/purchase-orders/3");
  });
});

describe("digestAlerts", () => {
  const w = { offerExpiryWarnDays: 14, warrantyWarnDays: 90, rfqClosingWarnDays: 3, maintenanceDueDays: 7 };
  const warranty = (i: number, facilityId = 1) => ({
    role: "BIOMEDICAL" as const, facilityId,
    n: { kind: "warranty_ending", title: `Warranty on TAG-${i} ends in 10 days`, href: `/assets/${i}`, dedupeKey: `warranty_ending:${i}:2026-11-09` },
  });
  it("keeps small groups as they are", () => {
    const out = digestAlerts([warranty(1), warranty(2), warranty(3)], "2026-10-30", w);
    expect(out).toHaveLength(3);
    expect(out[0].n.dedupeKey).toBe("warranty_ending:1:2026-11-09");
  });
  it("turns a large group into one summary per facility, linking to the list", () => {
    const out = digestAlerts([1, 2, 3, 4, 5].map((i) => warranty(i)).concat([warranty(9, 2)]), "2026-10-30", w, (id) => (id === 1 ? "La Plaza" : "DGH"));
    expect(out).toHaveLength(2);
    const d = out.find((a) => a.facilityId === 1)!;
    expect(d.n.title).toBe("5 warranties end within the warning window at La Plaza");
    expect(d.n.href).toBe("/reports/warranty-expiries?days=90&facilityId=1");
    expect(d.n.dedupeKey).toBe("warranty_ending_digest:1:2026-W44");
    expect(d.n.body).toMatch(/and 2 more/);
  });
  it("leaves other kinds alone", () => {
    const offers = [1, 2, 3, 4, 5].map((i) => ({ role: "PROCUREMENT" as const, facilityId: 1, n: { kind: "offer_expiring", title: `o${i}`, dedupeKey: `o${i}` } }));
    expect(digestAlerts(offers, "2026-10-30", w)).toHaveLength(5);
  });
  it("labels ISO weeks", () => {
    expect(isoWeek("2026-10-30")).toBe("2026-W44");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
});

describe("contractAlerts", () => {
  const row = { id: 7, number: "SC-2026-0007", title: "ICU ventilators", endDate: "2026-12-01", facilityId: 1, supplierName: "Delta", devices: 12 };
  it("warns biomedical and procurement within 60 days, once per end date", () => {
    const a = contractAlerts([row], "2026-10-15");
    expect(a.map((x) => x.role)).toEqual(["BIOMEDICAL", "PROCUREMENT"]);
    expect(a[0].n).toMatchObject({ kind: "contract_ending", href: "/assets/contracts/7", dedupeKey: "contract_ending:7:2026-12-01" });
    expect(a[0].n.body).toContain("12 devices");
  });
  it("is silent outside the window and after the end", () => {
    expect(contractAlerts([row], "2026-09-01")).toEqual([]);
    expect(contractAlerts([row], "2026-12-02")).toEqual([]);
  });
});

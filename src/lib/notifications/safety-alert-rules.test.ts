import { describe, expect, it } from "vitest";
import { digestAlerts } from "./alert-rules";
import {
  calibrationAlerts, collectSafetyAlerts, doseAlerts, licenceAlerts, lowStockAlerts, protectiveAlerts, qcAlerts, recallPendingAlerts, safetyTestAlerts, stage, testEquipmentAlerts,
} from "./safety-alert-rules";

const today = "2026-11-22";
const windows = { offerExpiryWarnDays: 14, warrantyWarnDays: 90, rfqClosingWarnDays: 3, maintenanceDueDays: 7 };
const dev = (o: Partial<Parameters<typeof calibrationAlerts>[0][number]> = {}) => ({ assetId: 4, tag: "DGH-MON-1", typeName: "Monitor", departmentName: "ICU", nextDue: "2026-12-01", facilityId: 1, ...o });

describe("stage", () => {
  it("due inside the window, overdue once past, nothing before", () => {
    expect(stage("2026-12-22", today, 30)).toBe("due");
    expect(stage("2026-12-23", today, 30)).toBeNull();
    expect(stage(today, today, 30)).toBe("due");
    expect(stage("2026-11-21", today, 30)).toBe("overdue");
    expect(stage(null, today, 30)).toBeNull();
  });
});

describe("device due alerts", () => {
  it("calibration: due and overdue, to biomedical and technicians, one per item, due date and stage", () => {
    const due = calibrationAlerts([dev()], today);
    expect(due.map((a) => a.role)).toEqual(["BIOMEDICAL", "TECHNICIAN"]);
    expect(due[0].n).toMatchObject({ kind: "calibration_due", href: "/assets/4#calibration", dedupeKey: "calibration_due:4:2026-12-01" });
    expect(due[0].n.title).toBe("Calibration due in 9 days: DGH-MON-1");
    const late = calibrationAlerts([dev({ nextDue: "2026-11-01" })], today)[0];
    expect(late.n).toMatchObject({ kind: "calibration_overdue", dedupeKey: "calibration_overdue:4:2026-11-01" });
    expect(late.n.body).toMatch(/21 days ago/);
    expect(calibrationAlerts([dev({ nextDue: "2027-03-01" })], today)).toEqual([]);
  });
  it("safety tests use their own kind and anchor", () => {
    const [a] = safetyTestAlerts([dev()], today);
    expect(a.n.kind).toBe("safety_test_due");
    expect(a.n.href).toBe("/assets/4#safety-tests");
  });
  it("many in one hospital become one summary through the existing digest", () => {
    const many = calibrationAlerts([1, 2, 3, 4, 5].map((i) => dev({ assetId: i, tag: `T-${i}`, nextDue: "2026-10-01" })), today);
    const d = digestAlerts(many, today, windows, () => "Demo hospital");
    expect(d).toHaveLength(2); // one per role
    expect(d[0].n.title).toBe("5 calibrations overdue at Demo hospital");
    expect(d[0].n.href).toBe("/assets/calibration?tab=due&facilityId=1");
    expect(d[0].n.dedupeKey).toBe(`calibration_overdue_digest:1:${today}`);
  });
});

describe("test equipment", () => {
  it("warns before the calibration runs out and once it has", () => {
    const row = { assetId: 9, tag: "DGH-BME-1", label: "Fluke ESA615", calibrationDue: "2026-12-10", facilityId: 1 };
    expect(testEquipmentAlerts([row], today)[0].n).toMatchObject({ kind: "test_equipment_calibration", dedupeKey: "test_eq_cal:9:2026-12-10:due" });
    expect(testEquipmentAlerts([{ ...row, calibrationDue: "2026-11-01" }], today)[0].n.title).toMatch(/has run out/);
    expect(testEquipmentAlerts([{ ...row, calibrationDue: "2027-06-01" }], today)).toEqual([]);
  });
});

describe("recalls and stock", () => {
  it("a recall with devices still pending, once a day per recall and hospital", () => {
    const [a] = recallPendingAlerts([{ recallId: 3, number: "FSCA-2026-0003", title: "Battery", urgent: true, dueDate: "2026-11-01", facilityId: 2, pending: 2 }], today);
    expect(a).toMatchObject({ role: "BIOMEDICAL", facilityId: 2 });
    expect(a.n.title).toBe("Urgent recall FSCA-2026-0003: 2 devices still to action (past its due date)");
    expect(a.n.dedupeKey).toBe(`recall_pending:3:2:${today}`);
    expect(recallPendingAlerts([{ recallId: 3, number: "X", title: "x", urgent: false, dueDate: null, facilityId: 2, pending: 0 }], today)).toEqual([]);
  });
  it("low stock shares the key of the alert sent on a movement, so there is no repeat that day", () => {
    const [a] = lowStockAlerts([{ id: 5, name: "SpO2 probe", partNumber: "P-5", stock: 1, min: 2, facilityId: 1 }], today);
    expect(a.n).toMatchObject({ kind: "part_low_stock", dedupeKey: `part_low:5:${today}`, href: "/assets/parts/5" });
    expect(lowStockAlerts([{ id: 6, name: "x", partNumber: "y", stock: 0, min: 0, facilityId: 1 }, { id: 7, name: "x", partNumber: "z", stock: 3, min: 2, facilityId: 1 }], today)).toEqual([]);
  });
});

describe("radiation safety", () => {
  it("licences 90 days ahead, then expired", () => {
    const l = { id: 1, licenceNumber: "ENRRA-1", expiresOn: "2027-02-20", covers: "X-ray room 1", facilityId: 1 };
    expect(licenceAlerts([l], today)[0].n).toMatchObject({ kind: "radiation_licence_expiring", dedupeKey: "enrra_licence:1:2027-02-20:due", href: "/assets/radiation/licences/1" });
    expect(licenceAlerts([{ ...l, expiresOn: "2027-02-21" }], today)).toEqual([]);
    expect(licenceAlerts([{ ...l, expiresOn: "2026-11-01" }], today)[0].n.kind).toBe("radiation_licence_expired");
  });
  it("QC tests and protective checks", () => {
    expect(qcAlerts([{ id: 8, testName: "Annual QC", label: "DGH-CT-1", nextDue: "2026-12-01", facilityId: 1 }], today)[0].n.kind).toBe("radiation_qc_due");
    const [p] = protectiveAlerts([{ itemId: 2, label: "Apron No. 12", kind: "APRON", nextDue: "2026-11-02", facilityId: 1 }], today);
    expect(p.n).toMatchObject({ kind: "protective_check_overdue", dedupeKey: "protective_check_overdue:2:2026-11-02" });
    expect(p.n.title).toBe("Lead apron check overdue: Apron No. 12");
  });
  it("flagged doses, once per reading", () => {
    const rows = [{ id: 1, personName: "A. Radiographer", periodEnd: "2026-10-31", doseMsv: 2.1, limitMsv: 1.7, flag: "OVER", facilityId: 1 }, { id: 2, personName: "B", periodEnd: "2026-10-31", doseMsv: 0.1, limitMsv: 1.7, flag: "OK", facilityId: 1 }];
    const a = doseAlerts(rows);
    expect(a).toHaveLength(1);
    expect(a[0].n).toMatchObject({ kind: "dose_flagged", dedupeKey: "dose_flagged:1" });
    expect(a[0].n.title).toBe("Dose over the limit: A. Radiographer");
  });
  it("collects every kind", () => {
    const all = collectSafetyAlerts({
      recalls: [], parts: [], safetyTests: [dev()], calibrations: [dev()], testEquipment: [], licences: [], qc: [], protective: [], doses: [],
    }, today);
    expect(all.map((a) => a.n.kind)).toEqual(["safety_test_due", "safety_test_due", "calibration_due", "calibration_due"]);
  });
});

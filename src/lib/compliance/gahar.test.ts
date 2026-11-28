import { describe, expect, it } from "vitest";
import { evidenceStatus, figureText, GAHAR_EDITION, GAHAR_MAP, GAHAR_NOTE, linkFor, packRows, packTotals, patientDoseFigure, pctOf, type EvidenceItem } from "./gahar";

const pct: EvidenceItem = { key: "ppm", text: "PPM", kind: "pct" };

describe("GAHAR evidence map", () => {
  it("covers EFS.10 EOC 1–6, EFS.11, EFS.12, DAS.05 and DAS.09", () => {
    const codes = GAHAR_MAP.map((s) => s.code);
    for (const c of ["EFS.10 EOC 1", "EFS.10 EOC 2–3", "EFS.10 EOC 4", "EFS.10 EOC 5", "EFS.10 EOC 6", "EFS.11", "EFS.12", "DAS.05", "DAS.09"]) expect(codes).toContain(c);
  });
  it("has each evidence key once", () => {
    const keys = GAHAR_MAP.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("says which edition and to check the handbook", () => {
    expect(GAHAR_EDITION).toBe("GAHAR 2025 standards");
    expect(GAHAR_NOTE).toMatch(/Check the current GAHAR handbook/);
  });
  it("reads utilities (EFS.11) and water (EFS.12) from PAMS records (wave 41)", () => {
    const efs = GAHAR_MAP.filter((s) => s.code === "EFS.11" || s.code === "EFS.12").flatMap((s) => s.items);
    expect(efs.length).toBeGreaterThanOrEqual(8);
    expect(efs.every((i) => i.kind !== "none" && i.link?.startsWith("/buildings/"))).toBe(true);
    const rows = packRows({ utility_tests: { pct: 92 }, generator_tests: { pct: 50 }, water_points: { count: 0 }, dialysis_water: null }, 3);
    const by = (k: string) => rows.find((r) => r.key === k)!;
    expect(by("utility_tests")).toMatchObject({ status: "have", href: "/buildings/utilities?facilityId=3" });
    expect(by("generator_tests").status).toBe("partly");
    expect(by("water_points").status).toBe("missing");
    expect(by("dialysis_water")).toMatchObject({ status: "not_recorded", href: "/buildings/water?facilityId=3" });
    expect(by("water_failures").detail).toBeNull();
  });
});

describe("evidenceStatus", () => {
  it("reads percentages against the threshold", () => {
    expect(evidenceStatus(pct, { pct: 95 })).toBe("have");
    expect(evidenceStatus(pct, { pct: 90 })).toBe("have");
    expect(evidenceStatus(pct, { pct: 40 })).toBe("partly");
    expect(evidenceStatus(pct, { pct: 0 })).toBe("missing");
    expect(evidenceStatus({ ...pct, have: 100 }, { pct: 99 })).toBe("partly");
  });
  it("no figure = not recorded", () => {
    expect(evidenceStatus(pct, null)).toBe("not_recorded");
    expect(evidenceStatus(pct, undefined)).toBe("not_recorded");
    expect(evidenceStatus(pct, { pct: null })).toBe("not_recorded");
    expect(evidenceStatus({ key: "imaging_qc_routine", text: "", kind: "none" }, { pct: 100 })).toBe("not_recorded");
  });
  it("counts and yes/no", () => {
    const c: EvidenceItem = { key: "dosimetry", text: "", kind: "count" };
    expect(evidenceStatus(c, { count: 3 })).toBe("have");
    expect(evidenceStatus(c, { count: 0 })).toBe("missing");
    const y: EvidenceItem = { key: "plan_approved", text: "", kind: "yes" };
    expect(evidenceStatus(y, { yes: true })).toBe("have");
    expect(evidenceStatus(y, { yes: false })).toBe("missing");
  });
});

describe("pack rows", () => {
  it("shows figures and links for the hospital", () => {
    const rows = packRows({ ppm: { pct: 87.25 }, plan_approved: { yes: true } }, 7);
    const ppm = rows.find((r) => r.key === "ppm")!;
    expect(ppm.figure).toBe("87.3 %");
    expect(ppm.status).toBe("partly");
    expect(ppm.href).toBe("/reports/ppm-compliance?facilityId=7");
    expect(rows.find((r) => r.key === "plan_approved")!.figure).toBe("Yes");
    const t = packTotals(rows);
    expect(t.have + t.partly + t.missing + t.not_recorded).toBe(rows.length);
  });
  it("drops the facility from links when none is chosen", () => {
    expect(linkFor(pct, null)).toBeNull();
    expect(linkFor({ ...pct, link: "/reports/x?facilityId={f}" }, null)).toBe("/reports/x");
    expect(linkFor({ ...pct, link: "/a?b=1&facilityId={f}" }, null)).toBe("/a?b=1");
  });
  it("figure text and shares", () => {
    expect(figureText({ key: "dosimetry", text: "", kind: "count" }, { count: 4 })).toBe("4");
    expect(figureText(pct, null)).toBe("—");
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(1, 0)).toBeNull();
  });
});

describe("DAS.09 patient dose (wave 43)", () => {
  const base = { compared: 10, ok: 9, above: 2, aboveReviewed: 1, noDrl: 3, drls: 12, exampleDrls: 0, anyRecords: true };
  it("is read from PAMS records, no longer 'Not recorded in PAMS'", () => {
    const item = GAHAR_MAP.find((s) => s.code === "DAS.09")!.items.find((i) => i.key === "patient_dose")!;
    expect(item.kind).toBe("pct");
    expect(item.link).toBe("/assets/patient-dose?facilityId={f}");
    const row = packRows({ patient_dose: patientDoseFigure(base, false) }, 2).find((r) => r.key === "patient_dose")!;
    expect(row).toMatchObject({ status: "have", figure: "90 %", href: "/assets/patient-dose?facilityId=2" });
    expect(row.detail).toMatch(/9 of 10 monthly exam groups/);
  });
  it("is missing without DRLs or records, and capped while the DRLs are only examples", () => {
    expect(patientDoseFigure({ ...base, drls: 0 }, false)).toMatchObject({ pct: 0, detail: expect.stringMatching(/No diagnostic reference levels/) });
    expect(patientDoseFigure({ ...base, anyRecords: false }, false)).toMatchObject({ pct: 0 });
    expect(patientDoseFigure({ ...base, compared: 0, ok: 0 }, false)?.pct).toBe(0);
    expect(patientDoseFigure({ ...base, exampleDrls: 12 }, false)?.pct).toBe(50);
    expect(patientDoseFigure({ ...base, exampleDrls: 12 }, false)?.detail).toMatch(/examples to replace/);
  });
  it("has no figure before the tables exist or with no X-ray devices and nothing recorded", () => {
    expect(patientDoseFigure(null, false)).toBeNull();
    expect(patientDoseFigure({ ...base, drls: 0, anyRecords: false }, true)).toBeNull();
  });
});

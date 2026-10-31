import { describe, expect, it } from "vitest";
import { bedSplit, buildScope, defaultAnswers } from "./templates";

const codes = (a: ReturnType<typeof buildScope>) => a.departments.map((d) => d.departmentTypeCode);

describe("hospital templates", () => {
  it("pre-fill answers from the type and ownership", () => {
    const a = defaultAnswers("general");
    expect(a).toMatchObject({ totalBeds: 150, icuBeds: 12, ccuBeds: 5, nicuBeds: 6, isolationBeds: 3, priceTier: "STANDARD", currency: "EGP" });
    expect(a.services).toMatchObject({ theatres: 5, cathLab: true, mri: true, deliveriesPerYear: 1800, dialysisChairs: 10 });
    expect(defaultAnswers("teaching", "private").priceTier).toBe("PREMIUM");
    expect(defaultAnswers("teaching").features).toEqual(["teaching", "trauma"]);
  });
  it("scale bed splits with minimum unit sizes, and skip units a type doesn't have", () => {
    expect(bedSplit("general", 40)).toEqual({ icuBeds: 4, ccuBeds: 4, nicuBeds: 4, isolationBeds: 2 });
    expect(bedSplit("specialized", 100)).toMatchObject({ nicuBeds: 0, icuBeds: 15 });
  });
});

describe("answers → scope", () => {
  it("builds every department a general hospital needs, beds adding up", () => {
    const s = buildScope(defaultAnswers("general", "government", 200));
    expect(s.problems).toEqual([]);
    expect(codes(s)).toEqual(expect.arrayContaining(["ER", "ICU", "CCU", "NICU", "ISO", "OR", "PACU", "WARD-MED", "WARD-SURG", "WARD-PED", "WARD-OBS", "LDR", "CATH", "RAD", "LAB", "DIAL", "ENDO", "OPD", "REHAB", "PHARM", "CSSD"]));
    const inpatient = s.departments.filter((d) => ["ICU", "CCU", "NICU", "ISO"].includes(d.departmentTypeCode) || d.departmentTypeCode.startsWith("WARD")).reduce((t, d) => t + d.beds, 0);
    expect(inpatient).toBe(200);
    expect(s.standardSet).toBe("HPAMS-GEN-2026");
  });
  it("puts throughput answers on radiology and delivery", () => {
    const s = buildScope(defaultAnswers("general", "government", 200));
    expect(s.departments.find((d) => d.departmentTypeCode === "RAD")!.params).toEqual({ ctExams: 11000, mriExams: 4000 });
    expect(s.departments.find((d) => d.departmentTypeCode === "LDR")).toMatchObject({ beds: 6, params: { deliveries: 2400 } });
    expect(s.assumptions.some((x) => x.startsWith("CT: about 11,000"))).toBe(true);
  });
  it("answers 0 for services turned off, so none is planned", () => {
    const a = defaultAnswers("general", "government", 120);
    a.services = { ...a.services, mri: false, deliveriesPerYear: 0, cathLab: false, dialysisChairs: 0 };
    const s = buildScope(a);
    expect(s.departments.find((d) => d.departmentTypeCode === "RAD")!.params.mriExams).toBe(0);
    expect(codes(s)).not.toContain("LDR");
    expect(codes(s)).not.toContain("WARD-OBS");
    expect(codes(s)).not.toContain("CATH");
    expect(s.assumptions).toContain("No MRI service.");
  });
  it("uses the tertiary standard and features for teaching and specialised hospitals", () => {
    expect(buildScope(defaultAnswers("teaching")).standardSet).toBe("HPAMS-TERT-2026");
    const wc = buildScope(defaultAnswers("womenChildren"));
    expect(codes(wc)).toEqual(expect.arrayContaining(["NICU", "LDR", "WARD-OBS", "WARD-PED"]));
    expect(codes(wc)).not.toContain("CATH");
  });
  it("reports impossible bed numbers", () => {
    const a = { ...defaultAnswers("general", "government", 50), icuBeds: 40 };
    expect(buildScope(a).problems[0]).toMatch(/can't be more than 70 %/);
    expect(buildScope({ ...a, totalBeds: 0 }).problems).toContain("Enter the total number of beds.");
  });
});

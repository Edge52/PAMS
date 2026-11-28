import { describe, expect, it } from "vitest";
import {
  ageGroupOf, checkGroups, compareWithDrl, doseEvidence, doseModalityOf, doseRecordProblem, EXAMPLE_DRLS, lastMonths, median, monthAfter, monthlyGroups,
  MODALITY_QUANTITIES, parseDoseTable, personalColumns, reviewKey, unitFactor, type DoseLookups, type DoseRecord, type Drl,
} from "./patient-dose";

const rec = (o: Partial<DoseRecord>): DoseRecord => ({ assetId: 1, facilityId: 1, examDate: "2026-10-05", modality: "CT", examType: "CT head", ageGroup: "ADULT", ...o });

describe("median", () => {
  it("takes the middle value, or the mean of the two middle values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, undefined])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe("DRL comparison", () => {
  it("flags a median above the DRL; equal is within", () => {
    expect(compareWithDrl(61, 60)).toEqual({ ratio: 61 / 60, state: "above" });
    expect(compareWithDrl(60, 60).state).toBe("within");
    expect(compareWithDrl(10, null)).toEqual({ ratio: null, state: "no_drl" });
  });

  it("groups by scanner, exam type, age group and month, and compares each quantity", () => {
    const records = [
      ...[50, 55, 70, 72, 80].map((v) => rec({ ctdivol: v, dlp: 900 })),
      rec({ examType: " ct  HEAD ", ctdivol: 75, dlp: 900 }),
      rec({ examDate: "2026-09-10", ctdivol: 40, dlp: 800 }),
      rec({ ageGroup: "CHILD_5", ctdivol: 30 }),
      rec({ assetId: 2, examType: "CT sinus", ctdivol: 20 }),
    ];
    const groups = monthlyGroups(records);
    const oct = groups.find((g) => g.assetId === 1 && g.month === "2026-10" && g.ageGroup === "ADULT")!;
    expect(oct.n).toBe(6);
    expect(oct.medians.ctdivol).toBe(71);
    const drls: Drl[] = [
      { facilityId: 1, modality: "CT", examType: "CT Head", ageGroup: "ADULT", quantity: "ctdivol", value: 60 },
      { facilityId: 1, modality: "CT", examType: "CT Head", ageGroup: "ADULT", quantity: "dlp", value: 970 },
      { facilityId: 2, modality: "CT", examType: "CT head", ageGroup: "ADULT", quantity: "ctdivol", value: 1 },
    ];
    const checked = checkGroups(groups, drls);
    const c = checked.find((g) => reviewKey(g) === reviewKey(oct))!;
    expect(c.state).toBe("above");
    expect(c.checks.map((x) => x.state)).toEqual(["above", "within"]);
    expect(c.smallSample).toBe(true);
    expect(checked.find((g) => g.month === "2026-09")!.state).toBe("within");
    expect(checked.find((g) => g.ageGroup === "CHILD_5")!.state).toBe("no_drl");
    expect(checked.find((g) => g.assetId === 2)!.state).toBe("no_drl");
    const ev = doseEvidence(checked, new Set());
    expect(ev).toMatchObject({ compared: 2, ok: 1, above: 1, aboveReviewed: 0, noDrl: 2 });
    expect(doseEvidence(checked, new Set([reviewKey(oct)])).ok).toBe(2);
  });

  it("ignores inactive DRLs", () => {
    const g = monthlyGroups([rec({ ctdivol: 100 })]);
    expect(checkGroups(g, [{ facilityId: 1, modality: "CT", examType: "CT head", ageGroup: "ADULT", quantity: "ctdivol", value: 60, active: false }])[0].state).toBe("no_drl");
  });
});

describe("example DRLs", () => {
  it("use only the quantities of their modality", () => {
    expect(EXAMPLE_DRLS.length).toBeGreaterThan(8);
    for (const d of EXAMPLE_DRLS) expect(MODALITY_QUANTITIES[d.modality]).toContain(d.quantity);
  });
});

describe("modality and age group", () => {
  it("reads the modality from the device type", () => {
    expect(doseModalityOf("IMG-CT-64")).toBe("CT");
    expect(doseModalityOf("IMG-MAM-DIG")).toBe("MAMMO");
    expect(doseModalityOf("IMG-MAM-ABUS")).toBeNull();
    expect(doseModalityOf("IMG-XR-CARM")).toBe("FLUORO");
    expect(doseModalityOf("IMG-ANG-SP")).toBe("FLUORO");
    expect(doseModalityOf("IMG-XR-DR")).toBe("XRAY");
    expect(doseModalityOf("IMG-MRI-15")).toBeNull();
  });
  it("turns text or an age into a group", () => {
    expect(ageGroupOf("Adult")).toBe("ADULT");
    expect(ageGroupOf("child_1")).toBe("CHILD_1");
    expect(ageGroupOf("42")).toBe("ADULT");
    expect(ageGroupOf("7 years")).toBe("CHILD_5");
    expect(ageGroupOf(0.5)).toBe("CHILD_0");
    expect(ageGroupOf("old")).toBeNull();
  });
});

describe("dose CSV import", () => {
  const lookups: DoseLookups = { scanners: new Map([["dgh-ct-000001", { assetId: 1, facilityId: 1, modality: "CT" as const }], ["xr-serial-9", { assetId: 2, facilityId: 1, modality: "FLUORO" as const }]]) };

  it("refuses a file with patient identifier columns", () => {
    for (const h of ["Patient name", "Patient ID", "MRN", "Accession number", "Date of birth", "DOB", "National ID", "Phone", "ID"]) {
      const r = parseDoseTable(`Date,Scanner,Exam type,${h},CTDIvol\n2026-10-01,DGH-CT-000001,CT head,x,50`, lookups, "2026-11-01");
      expect(r.error, h).toMatch(/patient identifier columns/);
      expect(r.valid).toHaveLength(0);
    }
    expect(personalColumns(["Protocol name", "Station name", "Exam", "Age", "Study description"])).toEqual([]);
  });

  it("reads exams, matches the scanner and converts units", () => {
    const csv = [
      "Study date,AE title,Study description,Protocol,Age,CTDIvol (mGy),DLP (mGy.cm),DAP (mGy·cm²),Fluoro time (s),Sex",
      "2026-10-01,DGH-CT-000001,CT head,Routine head,54,52.5,880,,,F",
      "2026-10-02,XR-SERIAL-9,Barium swallow,,8,,,4500,150,M",
      "2026-12-01,DGH-CT-000001,CT head,,,50,900,,,",
      "2026-10-03,UNKNOWN,CT head,,,50,900,,,",
      "2026-10-03,DGH-CT-000001,CT chest,,,,,,,",
    ].join("\n");
    const r = parseDoseTable(csv, lookups, "2026-11-01");
    expect(r.error).toBeUndefined();
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0]).toMatchObject({ assetId: 1, modality: "CT", examType: "CT head", protocol: "Routine head", ageGroup: "ADULT", ctdivol: 52.5, dlp: 880 });
    expect(r.valid[1]).toMatchObject({ assetId: 2, modality: "FLUORO", ageGroup: "CHILD_5", dap: 4.5, time: 2.5 });
    expect(Object.keys(r.valid[1])).not.toContain("sex");
    const errs = r.rows.filter((x) => x.errors.length).map((x) => x.errors.join(" "));
    expect(errs[0]).toMatch(/future/);
    expect(errs[1]).toMatch(/not an X-ray device/);
    expect(errs[2]).toMatch(/No dose value/);
  });

  it("needs date, scanner and exam type columns", () => {
    expect(parseDoseTable("Scanner,CTDIvol\nA,1", lookups, "2026-11-01").error).toMatch(/Missing: date, exam type/);
    expect(parseDoseTable("Date,Scanner,Exam", lookups, "2026-11-01").error).toMatch(/at least one exam/);
  });

  it("unit factors", () => {
    expect(unitFactor("dap", "DAP (µGy·m²)")).toBe(0.01);
    expect(unitFactor("dap", "KAP (cGy cm2)")).toBe(0.01);
    expect(unitFactor("dap", "DAP (Gy·cm²)")).toBe(1);
    expect(unitFactor("time", "Time (min)")).toBe(1);
  });
});

describe("entered records and months", () => {
  it("needs a dose value of the modality and no future date", () => {
    expect(doseRecordProblem({ examDate: "2026-10-01", modality: "CT" }, "2026-11-01")).toMatch(/CTDIvol/);
    expect(doseRecordProblem({ examDate: "2026-10-01", modality: "MAMMO", agd: 1.2 }, "2026-11-01")).toBeNull();
    expect(doseRecordProblem({ examDate: "2026-12-01", modality: "MAMMO", agd: 1.2 }, "2026-11-01")).toMatch(/future/);
  });
  it("lists the last months", () => {
    expect(lastMonths("2026-02-15", 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(monthAfter("2026-12")).toBe("2027-01-01");
    expect(monthAfter("2026-02")).toBe("2026-03-01");
  });
});

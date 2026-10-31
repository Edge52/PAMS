import { describe, expect, it } from "vitest";
import { classifyRoom, fitOut } from "./cad";

describe("room classification from CAD room names", () => {
  it.each([
    ["MED/SURG SINGLE (3)", "M/S1", "PATIENT_ROOM", 1],
    ["MED/SURG DOUBLE (1)", "M/S2", "PATIENT_ROOM", 2],
    ["GYNECOLOGY SINGLE (2)", "OBG", "PATIENT_ROOM", 1],
    ["ICU (4)", "ICU2", "ICU_BAY", 1],
    ["SCN 3", "NICU", "ICU_BAY", 1],
    ["GENERAL OR (1)", "SS", "OPERATING_ROOM", 0],
    ["C-SECTION 1", "LDR", "OPERATING_ROOM", 0],
    ["CT", "IMA", "IMAGING_ROOM", 0],
    ["CATH LAB (1)", "CATH", "IMAGING_ROOM", 0],
    ["ED EXAM ROOM (12)", "ER", "PATIENT_ROOM", 1],
    ["P/R (4)", "DCU", "PATIENT_ROOM", 1],
    ["P/R (2)", "END", "PROCEDURE_ROOM", 0],
    ["DENTAL , Exam Room (1)", "OUT", "CONSULTATION", 0],
    ["CORRIDOR", "GEN", "CORRIDOR", 0],
    ["PATIENT TLT", "OUT", "OTHER", 0],
    ["WORKSTATION", "M/S1", "NURSE_STATION", 0],
    ["HVAC ROOM", "GEN", "TECHNICAL", 0],
  ])("%s (%s) → %s", (name, dept, type, beds) => {
    expect(classifyRoom(name, dept)).toEqual({ type, beds });
  });
});

describe("illustrative fit-out", () => {
  const codes = (name: string, dept: string) => { const c = classifyRoom(name, dept); return fitOut(name, c.type, c.beds, dept); };
  it("a double ward room gets two beds, two monitors and two oxygen flowmeters", () => {
    expect(codes("MED/SURG DOUBLE (1)", "M/S2")).toEqual([{ code: "FUR-BED-WARDE", qty: 2 }, { code: "MON-PAT-VS", qty: 2 }, { code: "GAS-FLW-O2F", qty: 2 }]);
  });
  it("an ICU bay gets the critical-care set", () => {
    expect(codes("ICU (2)", "ICU1").map((x) => x.code)).toEqual(["FUR-BED-ICU", "MON-PAT-HIGH", "LIF-VEN-ICU", "INF-PMP-SYR", "INF-PMP-VOL", "SUR-SUC-MOB"]);
  });
  it("endoscopy procedure rooms and recovery bays differ although both are called P/R", () => {
    expect(codes("P/R (2)", "END")[0].code).toBe("END-FLX-GI");
    expect(codes("P/R (2)", "DCU")[0].code).toBe("FUR-BED-STRC");
  });
  it("imaging rooms get their modality", () => {
    expect(codes("CT", "IMA")).toEqual([{ code: "IMG-CT-128", qty: 1 }]);
    expect(codes("CATH LAB (1)", "CATH")[0].code).toBe("IMG-ANG-SP");
  });
  it("Basement 1: the unnamed pharmacy room is a pharmacy store with a medication refrigerator", () => {
    expect(classifyRoom("B1-PHA-01", "PHA")).toEqual({ type: "PHARMACY", beds: 0 });
    expect(codes("B1-PHA-01", "PHA")).toEqual([{ code: "PHA-CLD-REF", qty: 1 }]);
  });
  it("Basement 1 plant, parking, linen and warehouse rooms hold no medical equipment", () => {
    for (const [name, dept] of [["HVAC ROOM", "GEN"], ["Parking", "GEN"], ["Ramp 1", "GEN"], ["STORE", "GEN"], ["SUPPLIES", "WRH"], ["B1-LIN-01", "LIN"],
      ["B1-GEN-15", "GEN"], ["CORRIDOR", "MRG"], ["DATA", "GEN"]]) expect(codes(name, dept)).toEqual([]);
  });
  it("the rehab equipment store is recognised despite the drawing's spelling", () => {
    expect(codes("MEDICAL EQUIMPENT STORE", "RHB").map((x) => x.code)).toContain("INF-PMP-VOL");
  });
  it("toilets and corridors get nothing", () => {
    expect(codes("PATIENT TLT", "OUT")).toEqual([]);
    expect(codes("CORRIDOR", "GEN")).toEqual([]);
  });
});

describe("cleanCadText", () => {
  it("drops DWG multiline-text formatting codes", async () => {
    const { cleanCadText } = await import("./cad");
    expect(cleanCadText("\\pxqc;ORTHOTIC & PROTHESIS")).toBe("ORTHOTIC & PROTHESIS");
    expect(cleanCadText("SHOCKWAVE \\pxqc;ROOM")).toBe("SHOCKWAVE ROOM");
    expect(cleanCadText("{\\fArial|b1;ICU}\\PBAY 3")).toBe("ICU BAY 3");
    expect(cleanCadText("Plain  name ")).toBe("Plain name");
  });
});

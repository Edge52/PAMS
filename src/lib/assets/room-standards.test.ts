import { describe, expect, it } from "vitest";
import { BUILTIN_STANDARDS, checkRoom, checkState, parseSpec, specLines, standardFor } from "./room-standards";

const survey = { areaM2: 40, beds: 0, ceilingM: null, doorWidthM: null, floorLoadKgM2: null, services: null };

describe("room standards", () => {
  it("matches names first, then room types", () => {
    expect(standardFor("MRI 1", "IMAGING_ROOM")?.rule.label).toBe("MRI scan room");
    expect(standardFor("CT SCAN ROOM", "IMAGING_ROOM")?.rule.label).toBe("CT scan room");
    expect(standardFor("Reporting", "IMAGING_ROOM")?.rule.label).toBe("Imaging room (other)");
    expect(standardFor("Theatre 3", "OTHER")?.rule.label).toBe("Operating theatre");
    expect(standardFor("NICU BAY", "ICU_BAY")?.rule.label).toBe("Neonatal intensive care cot space");
    expect(standardFor("Bay 4", "ICU_BAY")?.rule.label).toBe("Intensive care bay (other)");
    expect(standardFor("ICU bay 4", "OTHER")?.rule.label).toBe("Intensive care bed space");
    expect(standardFor("Room 101", "PATIENT_ROOM")?.rule.label).toBe("Single patient room");
    expect(standardFor("Doctors' mess", "OTHER")).toBeNull();
  });
  it("every built-in rule has a valid pattern or a type", () => {
    for (const r of BUILTIN_STANDARDS) {
      expect(r.match || r.roomType).toBeTruthy();
      if (r.match) expect(() => new RegExp(r.match!)).not.toThrow();
    }
  });
  it("checks a room against the standard, per bed space when it has beds", () => {
    const icu = standardFor("ICU", "ICU_BAY")!.rule.spec;
    const rows = checkRoom(icu, { ...survey, areaM2: 120, beds: 6, ceilingM: 3, doorWidthM: 1.2 });
    expect(rows.find((r) => r.label.startsWith("Area per bed"))).toMatchObject({ have: "20 m²", state: "short" });
    expect(rows.find((r) => r.label === "Clear ceiling")?.state).toBe("ok");
    expect(rows.find((r) => r.label === "Door clear width")?.state).toBe("short");
    expect(checkState(rows)).toBe("short");
    const mri = standardFor("MRI", null)!.rule.spec;
    const m = checkRoom(mri, { ...survey, services: { rfShield: true, chilledWater: true } });
    expect(m.find((r) => r.label === "RF shielding")?.state).toBe("ok");
    expect(m.find((r) => r.label === "Quench pipe")?.state).toBe("unknown");
    expect(checkState(checkRoom({ floorFinish: "Vinyl" }, survey))).toBe("none");
  });
  it("checks medical gas outlets, per bed space when the room has beds", () => {
    const icu = standardFor("ICU", "ICU_BAY")!.rule.spec; // 4 O2, 4 VAC, 2 AIR a bed space
    const rows = checkRoom(icu, { ...survey, areaM2: 160, beds: 4, services: { gases: { O2: 16, VAC: 12 } } });
    expect(rows.find((r) => r.label === "Oxygen outlets")).toMatchObject({ need: "≥ 16 (4 a bed)", have: "16", state: "ok" });
    expect(rows.find((r) => r.label === "Vacuum outlets")?.state).toBe("short");
    expect(rows.find((r) => r.label === "Medical air outlets")?.state).toBe("unknown");
    const theatre = checkRoom(standardFor("Theatre 1", null)!.rule.spec, { ...survey, services: { gases: { O2: 0 } } });
    expect(theatre.find((r) => r.label === "Oxygen outlets")).toMatchObject({ need: "≥ 2", have: "0", state: "short" });
  });
  it("lists the sheet's lines", () => {
    const lines = specLines(standardFor("Theatre", null)!.rule.spec);
    expect(lines.find((l) => l.group === "Medical gases")?.value).toContain("Oxygen 2");
    expect(lines.find((l) => l.label === "Pressure")?.value).toBe("Positive to the corridor");
    expect(lines.find((l) => l.label === "Sockets")?.value).toBe("16, of which 12 on essential supply");
  });
  it("reads the editor's form", () => {
    const { spec, errors } = parseSpec({ minAreaM2: "25,5", gas_O2: "4", gas_VAC: "0", pressure: "negative", nurseCall: "yes", handWash: "", floorFinish: " Vinyl ", airChanges: "x" });
    expect(spec).toEqual({ minAreaM2: 25.5, gases: { O2: 4 }, pressure: "negative", nurseCall: true, floorFinish: "Vinyl" });
    expect(errors).toHaveLength(1);
  });
});

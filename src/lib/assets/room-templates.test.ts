import { describe, expect, it } from "vitest";
import { checkRoom, equipmentText, parseEquipment, parseSpec, roomWidthM, specLines, standardFor, templateNeeds } from "./room-standards";

const survey = { areaM2: 40, beds: 0, ceilingM: null, doorWidthM: null, floorLoadKgM2: null, services: null };

describe("room templates (wave 16, phase 4)", () => {
  it("finds the new templates by name", () => {
    expect(standardFor("CSSD Decontamination", "OTHER")?.rule.label).toBe("Sterile services: decontamination");
    expect(standardFor("CSSD Packing & Inspection", "OTHER")?.rule.label).toBe("Sterile services: packing and sterilising");
    expect(standardFor("Triage 2", "CONSULTATION")?.rule.label).toBe("Triage and assessment");
    expect(standardFor("Dental Clinic 1", "CONSULTATION")?.rule.label).toBe("Dental surgery");
    expect(standardFor("Microbiology Lab", "LAB")?.rule.label).toBe("Microbiology and containment laboratory");
    expect(standardFor("Blood Bank", "LAB")?.rule.label).toBe("Blood bank");
    expect(standardFor("Haematology", "LAB")?.rule.label).toBe("Clinical laboratory");
    expect(standardFor("Cath Lab 1", "OTHER")?.rule.label).toBe("Cath lab / hybrid theatre");
  });
  it("counts template equipment against the devices in the room, per bed space", () => {
    const icu = standardFor("ICU", "ICU_BAY")!.rule.spec;
    const rows = checkRoom(icu, { ...survey, areaM2: 160, beds: 2, devices: ["MON-PAT-HIGH", "MON-PAT-HIGH", "LIF-VEN-ICU", "INF-PMP-VOL"] });
    const eq = rows.filter((r) => r.kind === "equipment");
    expect(eq.find((r) => r.label === "Patient monitor")).toMatchObject({ need: "≥ 2", have: "2", state: "ok" });
    expect(eq.find((r) => r.label === "Ventilator")).toMatchObject({ need: "≥ 2", have: "1", state: "short" });
    expect(eq.find((r) => r.label === "Infusion pumps")).toMatchObject({ need: "≥ 6", state: "short" });
    // Without the room's devices (a BOQ plan) equipment is not checked.
    expect(checkRoom(icu, { ...survey, beds: 2 }).some((r) => r.kind === "equipment")).toBe(false);
  });
  it("checks the narrowest width of the outline", () => {
    expect(roomWidthM([[0, 0], [6, 0], [6, 3], [0, 3]])).toBeCloseTo(3);
    const rot = [[0, 0], [3, 3], [1, 5], [-2, 2]] as [number, number][]; // a 4.24 × 2.83 rectangle turned 45°
    expect(roomWidthM(rot)).toBeCloseTo(Math.hypot(2, 2));
    const ct = standardFor("CT scan room", "IMAGING_ROOM")!.rule.spec;
    expect(checkRoom(ct, { ...survey, widthM: 4.2 }).find((r) => r.label === "Clear width")).toMatchObject({ state: "short" });
  });
  it("reads and writes equipment lines", () => {
    const { items, errors } = parseEquipment("MON-PAT, 1 a bed, 0.6, Patient monitor\nlif-ven, 2, , Ventilator\nbad line");
    expect(errors).toHaveLength(1);
    expect(items).toEqual([{ code: "MON-PAT", label: "Patient monitor", n: 1, perBed: true, clearanceM: 0.6 }, { code: "LIF-VEN", label: "Ventilator", n: 2 }]);
    expect(parseEquipment(equipmentText(items)).items).toEqual(items);
    expect(parseSpec({ equipment: "IMG-CT, 1, 1, CT scanner", minWidthM: "5" }).spec).toMatchObject({ minWidthM: 5, equipment: [{ code: "IMG-CT" }] });
    expect(specLines({ equipment: items }).find((l) => l.group === "Equipment")?.value).toBe("1 a bed, 0.6 m clear around (MON-PAT)");
  });
  it("adds up what the templates need across rooms", () => {
    const icu = standardFor("ICU", "ICU_BAY")!.rule.spec, ct = standardFor("CT", "IMAGING_ROOM")!.rule.spec;
    const n = templateNeeds([{ spec: icu, beds: 6 }, { spec: icu, beds: 4 }, { spec: ct, beds: 0 }]);
    expect(n.get("MON-PAT")).toEqual({ label: "Patient monitor", need: 10, rooms: 2 });
    expect(n.get("IMG-CT")?.need).toBe(1);
  });
});

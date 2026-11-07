import { describe, expect, it } from "vitest";
import { presetById, presetRooms, presetSummary } from "./presets";

const rooms = [
  { id: 1, name: "CT 1", type: "IMAGING_ROOM", departmentId: 10, floorId: 100 },
  { id: 2, name: "Control room", type: "OTHER", departmentId: 10, floorId: 100 },
  { id: 3, name: "Corridor", type: "CORRIDOR", departmentId: 10, floorId: 100 },
  { id: 4, name: "Lift 2", type: "OTHER", departmentId: 10, floorId: 100 },
  { id: 5, name: "ICU (3)", type: "PATIENT_ROOM", departmentId: 20, floorId: 101 },
  { id: 6, name: "Bay 4", type: "ICU_BAY", departmentId: null, floorId: 102 },
  { id: 7, name: "MRI", type: "OTHER", departmentId: 30, floorId: 101 },
  { id: 8, name: "Office", type: "OFFICE", departmentId: 30, floorId: 101 },
];
const depts = [{ id: 10, name: "Radiology", typeCode: "RAD" }, { id: 20, name: "Intensive care unit 1", typeCode: null }, { id: 30, name: "Outpatients", typeCode: "OPD" }];

describe("view presets (wave 16)", () => {
  it("finds a preset's rooms by department type, department name, room type and room name", () => {
    expect(presetRooms(presetById("imaging"), rooms, depts)).toEqual([1, 2, 7]);
    expect(presetRooms(presetById("icu"), rooms, depts)).toEqual([5, 6]);
  });
  it("sums up the equipment, the preset's own categories first", () => {
    const assets = [
      { id: 1, roomId: 1, status: "IN_SERVICE", categoryCode: "IMG", category: "Imaging" },
      { id: 2, roomId: 1, status: "OUT_OF_SERVICE", categoryCode: "IMG", category: "Imaging" },
      { id: 3, roomId: 2, status: "IN_SERVICE", categoryCode: "FUR", category: "Furniture" },
      { id: 4, roomId: 2, status: "IN_SERVICE", categoryCode: "FUR", category: "Furniture" },
      { id: 5, roomId: 2, status: "IN_SERVICE", categoryCode: "FUR", category: "Furniture" },
      { id: 6, roomId: 8, status: "IN_SERVICE", categoryCode: "IMG", category: "Imaging" },
    ];
    const s = presetSummary(presetById("imaging"), [1, 2, 7], rooms, assets);
    expect(s).toMatchObject({ rooms: 3, floors: [100, 101], devices: 5, troubleRooms: [1] });
    expect(s.statuses[0]).toEqual({ status: "IN_SERVICE", n: 4 });
    expect(s.categories.map((c) => c.code)).toEqual(["IMG", "FUR"]);
  });
});

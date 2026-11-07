import { describe, expect, it } from "vitest";
import { loadColor, simPlace } from "./sim-on-model";

const rooms = [{ id: 1, type: "IMAGING_ROOM", departmentId: 5 }, { id: 2, type: "IMAGING_ROOM", departmentId: 5 }, { id: 3, type: "OFFICE", departmentId: 5 },
  { id: 4, type: "WARD", departmentId: 6 }, { id: 5, type: "STORE", departmentId: 6 }];
const devices = [{ id: 10, roomId: 2, typeCode: "IMG-CT-128" }, { id: 11, roomId: 1, typeCode: "IMG-XR-DR" }];

describe("simulation on the model (wave 17, phase 8)", () => {
  it("finds the rooms, scanners and lifts of each resource", () => {
    expect(simPlace("room:r3", rooms, devices).rooms).toEqual([3]);
    expect(simPlace("room:d5", rooms, devices).rooms).toEqual([1, 2]);
    expect(simPlace("bed:6", rooms, devices).rooms).toEqual([4]);
    expect(simPlace("scan:d5:IMG-CT", rooms, devices)).toEqual({ rooms: [2], devices: [10], lifts: null });
    expect(simPlace("lift:bed", rooms, devices).lifts).toBe("bed");
    expect(simPlace("porter", rooms, devices)).toEqual({ rooms: [], devices: [], lifts: null });
  });
  it("colours the load", () => {
    expect(loadColor(0.5)).toBe("#3ddc97"); expect(loadColor(0.7)).toBe("#ffd166"); expect(loadColor(0.9)).toBe("#ff5a6a"); expect(loadColor(null)).toBe("#7c8c99");
  });
});

import { describe, expect, it } from "vitest";
import type { Link, Step } from "./model";
import { buildSimModel, type MFlow } from "./simulate-model";
import { simulate } from "./simulate";

const step = (key: string, kind: Step["kind"], extra: Partial<Step> = {}): Step => ({ key, label: key.toUpperCase(), kind, departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null, ...extra });
const link = (fromKey: string, toKey: string, share = 100, transport: Link["transport"] = "BED"): Link => ({ fromKey, toKey, share, transport, urgency: "ROUTINE", condition: null });
const rooms = [
  { id: 1, name: "CT 1", type: "IMAGING_ROOM", departmentId: 10, level: 0, beds: 0 },
  { id: 2, name: "Exam 1", type: "CONSULTATION", departmentId: 20, level: 0, beds: 0 },
  { id: 3, name: "Exam 2", type: "CONSULTATION", departmentId: 20, level: 0, beds: 0 },
  { id: 4, name: "Office", type: "OFFICE", departmentId: 20, level: 0, beds: 0 },
  { id: 5, name: "Ward bay", type: "WARD", departmentId: 30, level: 2, beds: 6 },
];
const depts = [{ id: 10, name: "Radiology" }, { id: 20, name: "Clinic" }, { id: 30, name: "Ward" }];
const flow: MFlow = {
  id: 1, name: "Outpatients", kind: "PATIENT", dailyVolume: 24, arrivalProfile: null,
  steps: [step("a", "START", { departmentId: 20 }), step("c", "STEP", { departmentId: 20, minutes: 30 }), step("ct", "STEP", { roomId: 1, minutes: 20, equipment: ["IMG-CT-128"] }),
    step("w", "STEP", { departmentId: 30, minutes: 2880 }), step("z", "END")],
  links: [link("a", "c", 100, "FOOT"), link("c", "ct", 50, "FOOT"), link("c", "z", 50, "FOOT"), link("ct", "w", 25), link("ct", "z", 75, "FOOT"), link("w", "z")],
};

describe("simulation model from a hospital", () => {
  const { model, skipped } = buildSimModel([flow, { ...flow, id: 2, name: "No volume", dailyVolume: null }], rooms, depts, [{ roomId: 1, typeCode: "IMG-CT-128" }], [{ kind: "BED", cars: 1 }, { kind: "PUBLIC", cars: 2 }]);
  it("finds what each step waits for, as the analysis does", () => {
    const by = new Map(model.resources.map((r) => [r.key, r]));
    expect(by.get("room:d20")).toMatchObject({ kind: "room", capacity: 2 });
    expect(by.get("scan:r1:IMG-CT")).toMatchObject({ kind: "scanner", capacity: 1 });
    // No beds registered: the beds of the ward's rooms.
    expect(by.get("bed:30")).toMatchObject({ kind: "bed", capacity: 6 });
    expect(by.get("lift:bed")?.capacity).toBe(1);
    expect(by.get("lift:all")?.capacity).toBe(3);
    expect(by.get("porter")?.capacity).toBe(4);
    expect(model.flows[0].steps.find((s) => s.key === "w")).toMatchObject({ resource: "bed:30", level: 2 });
    expect(skipped).toEqual(["No volume: no patients a day set"]);
  });
  it("runs on the built model", () => {
    const s = simulate(model, { runs: 3 });
    expect(s.flows[0].finished.mean).toBeGreaterThan(5);
    expect(s.resources.find((r) => r.key === "lift:bed")!.utilisation.mean).toBeGreaterThan(0);
  });
});

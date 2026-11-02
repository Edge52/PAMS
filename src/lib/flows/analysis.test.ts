import { describe, expect, it } from "vitest";
import { analyse, corridorHeat, liftLoad, roundTrip, type AFlow } from "./analysis";
import type { Link, Step } from "./model";

const step = (key: string, kind: Step["kind"], extra: Partial<Step> = {}): Step => ({ key, label: key.toUpperCase(), kind, departmentId: null, roomId: null, minutes: null, accompanying: null, equipment: [], notes: null, ...extra });
const link = (fromKey: string, toKey: string, share = 100): Link => ({ fromKey, toKey, share, transport: "BED", urgency: "ROUTINE", condition: null });

// Worked example (docs/pathway-analysis.md): 24 patients a day, all arriving between 10:00 and 11:00 (half) or spread.
const profile = Array.from({ length: 24 }, (_, h) => (h === 10 ? 0.5 : 0.5 / 23));
const rooms = [
  { id: 1, name: "CT 1", type: "IMAGING_ROOM", departmentId: 10 },
  { id: 2, name: "Exam 1", type: "CONSULTATION", departmentId: 20 },
  { id: 3, name: "Exam 2", type: "CONSULTATION", departmentId: 20 },
  { id: 4, name: "Office", type: "OFFICE", departmentId: 20 },
  { id: 5, name: "Ward bay", type: "WARD", departmentId: 30 },
];
const depts = [{ id: 10, name: "Radiology" }, { id: 20, name: "Clinic" }, { id: 30, name: "Ward" }];
const flow: AFlow = {
  id: 1, name: "Outpatients", dailyVolume: 24, arrivalProfile: profile,
  steps: [
    step("a", "START"),
    step("c", "STEP", { departmentId: 20, minutes: 30 }),
    step("ct", "STEP", { roomId: 1, minutes: 20, equipment: ["IMG-CT-128"] }),
    step("w", "STEP", { departmentId: 30, minutes: 2880 }),
    step("z", "END"),
  ],
  links: [link("a", "c"), link("c", "ct", 50), link("c", "z", 50), link("ct", "w", 25), link("ct", "z", 75), link("w", "z")],
};
const assets = [{ roomId: 1, typeCode: "IMG-CT-128" }, { roomId: 5, typeCode: "FUR-BED-WARD" }];

describe("analyse (hand calculation)", () => {
  const a = analyse([flow], rooms, depts, assets);
  it("room load at the peak hour, over the department's care rooms", () => {
    const clinic = a.load.find((r) => r.place === "Clinic")!;
    // Peak hour 10:00: 24 × 0.5 = 12 arrivals × 30 min ÷ 60 = 6 at once, ÷ 2 exam rooms (the office doesn't count) = 300 %.
    expect(clinic.peakHour).toBe(10);
    expect(clinic.atOncePeak).toBeCloseTo(6);
    expect(clinic.rooms).toBe(2);
    expect(clinic.utilisation).toBeCloseTo(3);
    expect(clinic.flag).toBe(true);
    const ct = a.load.find((r) => r.place === "CT 1")!;
    // 12 patients a day reach CT; peak 6 × 20 ÷ 60 = 2 at once in 1 room.
    expect(ct.patientsPerDay).toBe(12);
    expect(ct.utilisation).toBeCloseTo(2);
  });
  it("beds needed for long stays", () => {
    // 12 × 25 % = 3 patients a day × 2 days = 6 beds, against 1 registered bed.
    expect(a.beds[0]).toMatchObject({ department: "Ward", patientsPerDay: 3, bedsNeeded: 6, beds: 1, source: "devices", flag: true });
  });
  it("scanner load against yearly capacity", () => {
    // 12 a day × 365 = 4,380 exams against 1 × 12,000 = 36.5 %.
    expect(a.scanners[0].examsPerYear).toBe(4380);
    expect(a.scanners[0].utilisation).toBeCloseTo(0.365);
    expect(a.scanners[0].flag).toBe(false);
  });
  it("skips pathways without a volume", () => {
    expect(analyse([{ ...flow, dailyVolume: null }], rooms, depts, assets).skipped[0]).toMatch(/no patients a day/);
  });
});

describe("lift load", () => {
  it("peak trips × round trip ÷ car-seconds", () => {
    // Bed, 4 storeys: 2×20 + 2×60 + 2×4×8 = 224 s. 30 trips a day, 10 % in the peak hour = 3 trips → 672 s of 3600 = 18.7 %.
    expect(roundTrip(4, "bed")).toBe(224);
    const [row] = liftLoad([{ lift: "Bed lift", perDay: 30, peakShare: 0.1, storeys: 4, journey: "bed" }], () => 1);
    expect(row.peakTrips).toBe(3);
    expect(row.utilisation).toBeCloseTo(672 / 3600);
    expect(row.flag).toBe(false);
    expect(liftLoad([{ lift: "Bed lift", perDay: 150, peakShare: 0.1, storeys: 4, journey: "bed" }], () => 1)[0].flag).toBe(true);
  });
});

describe("corridor heat", () => {
  it("adds each leg's patients once per 2 m cell it crosses", () => {
    const h = corridorHeat([
      { floorId: 1, points: [[0, 1], [10, 1]], perDay: 5 },
      { floorId: 1, points: [[0, 1], [3, 1]], perDay: 2 },
    ]);
    expect(h.get("1:0:0")?.perDay).toBe(7);
    expect(h.get("1:4:0")?.perDay).toBe(5);
    expect([...h.values()].filter((c) => c.perDay === 5).length).toBe(4); // cells 2..5 (x 4–10 m)
  });
});

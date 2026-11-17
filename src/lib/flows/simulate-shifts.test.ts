import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { capacityByHour, cleanClosed, cleanShift, closedLabel, hourRange, simulate, type SimModel } from "./simulate";
import { withStaff } from "./simulate-model";

const even = Array.from({ length: 24 }, () => 1 / 24);
const peak = Array.from({ length: 24 }, (_, h) => (h >= 8 && h < 18 ? 0.08 : 0.2 / 14));
const model: SimModel = {
  flows: [
    { id: 1, name: "ED", kind: "PATIENT", perDay: 90, profile: peak,
      steps: [{ key: "s", label: "In", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "t", label: "Triage", kind: "STEP", minutes: 8, resource: "room:t", level: 0 },
        { key: "x", label: "CT", kind: "STEP", minutes: 15, resource: "scan", level: 0 }, { key: "w", label: "Ward", kind: "STEP", minutes: 600, resource: "bed", level: 3 }, { key: "e", label: "Out", kind: "END", minutes: 0, resource: null, level: 0 }],
      links: [{ from: "s", to: "t", share: 100, transport: "FOOT", urgent: false }, { from: "t", to: "x", share: 40, transport: "TROLLEY", urgent: true }, { from: "t", to: "e", share: 60, transport: "FOOT", urgent: false },
        { from: "x", to: "w", share: 30, transport: "BED", urgent: false }, { from: "x", to: "e", share: 70, transport: "WHEELCHAIR", urgent: false }, { from: "w", to: "e", share: 100, transport: "BED", urgent: false }] },
    { id: 2, name: "OP", kind: "PATIENT", perDay: 40, profile: even,
      steps: [{ key: "s", label: "In", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "x", label: "CT", kind: "STEP", minutes: 12, resource: "scan", level: 1 }, { key: "e", label: "Out", kind: "END", minutes: 0, resource: null, level: 0 }],
      links: [{ from: "s", to: "x", share: 100, transport: "FOOT", urgent: false }, { from: "x", to: "e", share: 100, transport: "FOOT", urgent: false }] },
  ],
  resources: [{ key: "room:t", label: "Triage", kind: "room", capacity: 2 }, { key: "scan", label: "CT", kind: "scanner", capacity: 1 }, { key: "bed", label: "Beds", kind: "bed", capacity: 6 },
    { key: "porter", label: "Porters", kind: "porter", capacity: 2 }, { key: "lift:bed", label: "Bed lifts", kind: "lift", capacity: 1 }, { key: "lift:all", label: "Lifts", kind: "lift", capacity: 2 }],
  liftForBeds: "lift:bed", liftForAll: "lift:all", porter: "porter",
};
const old = (s: ReturnType<typeof simulate>) => ({ runs: s.runs, resources: s.resources.map((r) => ({ key: r.key, capacity: r.capacity, utilisation: r.utilisation, meanWait: r.meanWait, p90Wait: r.p90Wait, maxQueue: r.maxQueue, hourly: r.hourly, queueHourly: r.queueHourly, peakHour: r.peakHour, flag: r.flag })),
  flows: s.flows.map((f) => ({ id: f.id, arrived: f.arrived, finished: f.finished, meanTime: f.meanTime, p90Time: f.p90Time, meanWait: f.meanWait })) });
const fingerprint = (xs: ReturnType<typeof simulate>[]) => createHash("sha256").update(JSON.stringify(xs.map(old))).digest("hex");
const single = (perDay: number, minutes: number, capacity = 1): SimModel => ({
  flows: [{ id: 1, name: "A", kind: "PATIENT", perDay, profile: even,
    steps: [{ key: "s", label: "In", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "x", label: "Room", kind: "STEP", minutes, resource: "room", level: 0 }, { key: "e", label: "Out", kind: "END", minutes: 0, resource: null, level: 0 }],
    links: [{ from: "s", to: "x", share: 100, transport: "FOOT", urgent: false }, { from: "x", to: "e", share: 100, transport: "FOOT", urgent: false }] }],
  resources: [{ key: "room", label: "Room", kind: "room", capacity }], liftForBeds: null, liftForAll: null, porter: null,
});
const night = [0, 1, 2, 3, 4, 5, 6];

describe("simulation shifts (wave 28)", () => {
  it("gives exactly the earlier results when the new settings are empty", () => {
    // Fingerprint of these three runs taken from the wave 15 engine, before shifts were added.
    const WAVE_15 = "c471078832a6b6af821fe86dcdf874609786639ba081cb9079ba6bb2135cb4f8";
    const staffed = withStaff(model, [{ key: "", label: "Radiographers", count: 1, uses: ["scan"] }]);
    for (const extra of [{}, { shifts: {}, closed: {}, leaveAfter: {} }]) {
      expect(fingerprint([
        simulate(model, { runs: 4, seed: 3, ...extra }),
        simulate(model, { runs: 3, seed: 5, days: 7, hours: { scan: { open: 8, close: 20, weekends: false } }, books: { 2: { from: 9, to: 15, noShow: 0.1 } }, ...extra }),
        simulate(staffed, { runs: 3, seed: 2, capacity: { porter: 1 }, levels: { "2:x": 4 }, ...extra }),
      ])).toBe(WAVE_15);
    }
  });

  it("reads profiles and closed hours defensively", () => {
    expect(capacityByHour(3, null, null)).toBeNull();
    expect(capacityByHour(3, null, [22, 23, 99, -1])).toEqual([...Array(22).fill(3), 0, 0]);
    const shift = Array.from({ length: 24 }, (_, h) => (h < 8 ? 1 : 4));
    expect(capacityByHour(9, shift, [0])).toEqual([0, ...shift.slice(1)]);
    expect(capacityByHour(2, [1, 2], null)).toBeNull(); // not 24 numbers: ignored
    expect(cleanShift(Array(24).fill("2.6"))).toEqual(Array(24).fill(3));
    expect(cleanShift([1, 2, 3])).toBeNull();
    expect(cleanShift([...Array(23).fill(1), "x"])).toBeNull();
    expect(cleanClosed([23, 0, 0, 5.5, 24, "1"])).toEqual([0, 1, 23]);
    expect(cleanClosed([])).toBeNull();
    expect(closedLabel([22, 23, 0, 1, 2, 3, 4, 5, 6])).toBe("22:00–07:00");
    expect(closedLabel([12, 15, 16])).toBe("12:00–13:00, 15:00–17:00");
    expect(hourRange(22, 7)).toEqual([22, 23, 0, 1, 2, 3, 4, 5, 6]);
    expect(hourRange(8, 10)).toEqual([8, 9]);
    expect(hourRange(5, 5)).toEqual([]);
    expect(hourRange(-1, 24)).toEqual([23]);
    expect(closedLabel(Array.from({ length: 24 }, (_, h) => h))).toBe("all day");
  });

  it("a flat shift equal to the capacity changes nothing", () => {
    const a = simulate(single(150, 8, 2), { runs: 4, seed: 6 });
    const b = simulate(single(150, 8, 2), { runs: 4, seed: 6, shifts: { room: Array(24).fill(2) } });
    expect(fingerprint([b])).toBe(fingerprint([a]));
  });

  it("fewer on duty at night make night-time waits longer", () => {
    // 2 rooms by day, 1 from 00:00 to 07:00: 100 × 20 min a day ≈ 1.4 rooms busy on average.
    const shift = Array.from({ length: 24 }, (_, h) => (h < 7 ? 1 : 2));
    const day = simulate(single(100, 20, 2), { runs: 8, seed: 3 });
    const shifted = simulate(single(100, 20, 2), { runs: 8, seed: 3, shifts: { room: shift } });
    const room = shifted.resources[0];
    expect(room.capacity).toBe(2);
    const nightWait = (s: typeof day) => night.reduce((a, h) => a + s.resources[0].waitHourly[h], 0) / night.length;
    expect(nightWait(shifted)).toBeGreaterThan(nightWait(day) + 10);
    // The busy share at night is of the one room on duty.
    expect(room.hourly[3]).toBeGreaterThan(day.resources[0].hourly[3] * 1.5);
    expect(shifted.flows[0].waitByHour).toHaveLength(24);
    expect(shifted.flows[0].waitByHour[3]).toBeGreaterThan(shifted.flows[0].waitByHour[14]);
  });

  it("a room closed at night does no work then, and night arrivals wait for it to open", () => {
    const s = simulate(single(48, 10), { runs: 5, seed: 2, closed: { room: night } });
    expect(s.resources[0].hourly[3]).toBe(0);
    expect(s.resources[0].hourly[12]).toBeGreaterThan(0);
    expect(s.flows[0].waitByHour[2]).toBeGreaterThan(120); // arrived at 02:00, seen after 07:00
    expect(s.flows[0].waitByHour[12]).toBeLessThan(30);
    expect(s.flows[0].patientsByHour[2]).toBeGreaterThan(0.5); // 2 an hour
  });

  it("patients leave unseen after the set wait, and are not counted as finished", () => {
    const m = single(200, 10); // 200 × 10 min = 1.4 rooms' work for one room: the queue grows all day
    const stay = simulate(m, { runs: 4, seed: 1 });
    const leave = simulate(m, { runs: 4, seed: 1, leaveAfter: { 1: 60 } });
    expect(stay.flows[0].left.mean).toBe(0);
    expect(leave.flows[0].left.mean).toBeGreaterThan(20);
    // With no one giving up, the queue left from the day before holds most of the day's patients inside.
    expect(leave.flows[0].finished.mean).toBeGreaterThan(stay.flows[0].finished.mean);
    // Those who are seen waited at most about an hour; the room's waits shrink.
    expect(leave.resources[0].maxQueue.mean).toBeLessThan(stay.resources[0].maxQueue.mean);
    expect(leave.flows[0].meanWait.mean).toBeLessThan(61);
    // Every pathway patient is accounted for: finished, left or still inside at the end.
    expect(leave.flows[0].finished.mean + leave.flows[0].left.mean).toBeLessThanOrEqual(leave.flows[0].arrived.mean + 1);
    // A limit on another pathway changes nothing here.
    expect(simulate(m, { runs: 4, seed: 1, leaveAfter: { 9: 5 } }).flows[0].left.mean).toBe(0);
  });

  it("a patient waiting for staff after getting the room gives the room back on leaving", () => {
    const m = withStaff(single(120, 15, 3), [{ key: "", label: "Nurses", count: 1, uses: ["room"] }]);
    const s = simulate(m, { runs: 4, seed: 2, leaveAfter: { 1: 30 } });
    expect(s.flows[0].left.mean).toBeGreaterThan(5);
    const room = s.resources.find((r) => r.key === "room")!, staff = s.resources.find((r) => r.kind === "staff")!;
    // The rooms are held only while a nurse works or while waiting for one; never more than the 3 rooms.
    expect(room.utilisation.mean).toBeLessThanOrEqual(1);
    expect(staff.utilisation.mean).toBeGreaterThan(0.7);
  });
});

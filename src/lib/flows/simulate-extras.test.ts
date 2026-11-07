import { describe, expect, it } from "vitest";
import { bookedTimes, cleanHours, simulate, type SimModel } from "./simulate";
import { withStaff } from "./simulate-model";

const even = Array.from({ length: 24 }, () => 1 / 24);
const single = (perDay: number, minutes: number, capacity = 1): SimModel => ({
  flows: [{ id: 1, name: "A", kind: "PATIENT", perDay, profile: even,
    steps: [{ key: "s", label: "In", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "x", label: "Room", kind: "STEP", minutes, resource: "room", level: 0 }, { key: "e", label: "Out", kind: "END", minutes: 0, resource: null, level: 0 }],
    links: [{ from: "s", to: "x", share: 100, transport: "FOOT", urgent: false }, { from: "x", to: "e", share: 100, transport: "FOOT", urgent: false }] }],
  resources: [{ key: "room", label: "Room", kind: "room", capacity }], liftForBeds: null, liftForAll: null, porter: null,
});

describe("simulation extras (wave 15)", () => {
  it("cleans opening hours", () => {
    expect(cleanHours({ open: 8, close: 20, weekends: false })).toEqual({ open: 8, close: 20, weekends: false });
    expect(cleanHours({ open: 0, close: 24, weekends: true })).toBeNull();
    expect(cleanHours({ open: 20, close: 8, weekends: true })).toBeNull();
    expect(cleanHours({ open: 7.4, close: 30, weekends: true })).toEqual({ open: 7.5, close: 24, weekends: true });
  });

  it("books patients evenly through the session", () => {
    expect(bookedTimes(4, { from: 8, to: 10, noShow: 0 })).toEqual([480, 510, 540, 570]);
    expect(bookedTimes(0, { from: 8, to: 10, noShow: 0 })).toEqual([]);
    expect(bookedTimes(3, { from: 10, to: 8, noShow: 0 })).toEqual([]);
  });

  it("makes patients who come when a room is closed wait for it to open", () => {
    const always = simulate(single(48, 10), { runs: 5, seed: 2 });
    const day = simulate(single(48, 10), { runs: 5, seed: 2, hours: { room: { open: 8, close: 16, weekends: true } } });
    expect(day.resources[0].meanWait.mean).toBeGreaterThan(always.resources[0].meanWait.mean + 30);
    // Busy share is of the open hours: no work at 03:00, more than the all-day figure while open.
    expect(day.resources[0].hourly[3]).toBe(0);
    expect(day.resources[0].utilisation.mean).toBeGreaterThan(always.resources[0].utilisation.mean * 2);
  });

  it("booked patients wait less than walk-ins at the same load, and no-shows don't come", () => {
    // 40 patients from 08:00 to 18:00 = one every 15 minutes for a 12-minute step.
    const walkIn = simulate(single(40, 12), { runs: 10, seed: 4, variability: 0.25 });
    const booked = simulate(single(40, 12), { runs: 10, seed: 4, variability: 0.25, books: { 1: { from: 8, to: 18, noShow: 0 } } });
    expect(booked.flows[0].arrived.mean).toBe(40);
    expect(booked.resources[0].meanWait.mean).toBeLessThan(5);
    const noShows = simulate(single(40, 12), { runs: 10, seed: 4, books: { 1: { from: 8, to: 18, noShow: 0.25 } } });
    expect(noShows.flows[0].arrived.mean).toBeGreaterThan(25); expect(noShows.flows[0].arrived.mean).toBeLessThan(35);
    expect(walkIn.flows[0].arrived.mean).toBeGreaterThan(30);
  });

  it("holds staff with the room, so too few staff make a queue", () => {
    const m = single(200, 20, 4); // 4 rooms; 200 × 20 min a day ≈ 2.8 rooms busy
    const plenty = simulate(withStaff(m, [{ key: "", label: "Radiographers", count: 4, uses: ["room"] }]), { runs: 5, seed: 1 });
    const short = simulate(withStaff(m, [{ key: "", label: "Radiographers", count: 2, uses: ["room"] }]), { runs: 5, seed: 1 });
    const staff = short.resources.find((r) => r.kind === "staff")!;
    expect(staff).toMatchObject({ key: "staff:1", label: "Radiographers", capacity: 2 });
    expect(staff.utilisation.mean).toBeGreaterThan(0.85);
    expect(short.flows[0].meanWait.mean).toBeGreaterThan(plenty.flows[0].meanWait.mean + 30);
    // Groups with no name or nothing they can work are left out.
    expect(withStaff(m, [{ key: "", label: " ", count: 3, uses: ["room"] }, { key: "", label: "Nurses", count: 3, uses: ["nothing"] }])).toBe(m);
  });

  it("moving a step to another floor adds lift trips", () => {
    const m = single(100, 10, 0);
    const lifted: SimModel = { ...m, liftForAll: "lift", resources: [...m.resources, { key: "lift", label: "Lifts", kind: "lift", capacity: 1 }] };
    const same = simulate(lifted, { runs: 3 }), moved = simulate(lifted, { runs: 3, levels: { "1:x": 3 } });
    expect(same.resources.find((r) => r.key === "lift")!.utilisation.mean).toBe(0);
    expect(moved.resources.find((r) => r.key === "lift")!.utilisation.mean).toBeGreaterThan(0.05);
    expect(moved.flows[0].meanTime.mean).toBeGreaterThan(same.flows[0].meanTime.mean);
  });
});

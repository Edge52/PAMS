import { describe, expect, it } from "vitest";
import { gammaTime, rng, simulate, simulateOnce, DEFAULT_OPTIONS, type SimModel } from "./simulate";

const even = Array.from({ length: 24 }, () => 1 / 24);
/** One step with one resource: an M/M/1 queue when times are exponential (variability 1). */
const single = (perDay: number, minutes: number, capacity = 1, urgent = false): SimModel => ({
  flows: [{ id: 1, name: "A", kind: "PATIENT", perDay, profile: even,
    steps: [{ key: "s", label: "In", kind: "START", minutes: 0, resource: null, level: 0 }, { key: "x", label: "Room", kind: "STEP", minutes, resource: "room", level: 0 }, { key: "e", label: "Out", kind: "END", minutes: 0, resource: null, level: 0 }],
    links: [{ from: "s", to: "x", share: 100, transport: "FOOT", urgent }, { from: "x", to: "e", share: 100, transport: "FOOT", urgent: false }] }],
  resources: [{ key: "room", label: "Room", kind: "room", capacity }], liftForBeds: null, liftForAll: null, porter: null,
});

describe("queue simulation", () => {
  it("draws times with the asked mean and spread", () => {
    const r = rng(7);
    const xs = Array.from({ length: 20000 }, () => gammaTime(r, 10, 0.5));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    expect(m).toBeGreaterThan(9.7); expect(m).toBeLessThan(10.3);
    expect(sd / m).toBeGreaterThan(0.45); expect(sd / m).toBeLessThan(0.55);
    expect(gammaTime(r, 10, 0)).toBe(10);
  });

  it("matches an M/M/1 queue: 50 % busy, 6 minutes' average wait", () => {
    // 120 a day = 5 an hour; 6-minute exponential service = 10 an hour; Wq = ρ / (μ − λ) = 0.5 / 5 h = 6 min.
    const s = simulate(single(120, 6), { days: 7, runs: 12, variability: 1, weekendShare: 1, seed: 3 });
    const room = s.resources[0];
    expect(room.utilisation.mean).toBeGreaterThan(0.46); expect(room.utilisation.mean).toBeLessThan(0.54);
    expect(room.meanWait.mean).toBeGreaterThan(4.5); expect(room.meanWait.mean).toBeLessThan(7.5);
    expect(room.hourly).toHaveLength(24);
    expect(s.flows[0].finished.mean).toBeGreaterThan(780); // ≈ 840 a week
  });

  it("gives the same answer for the same seed, and no waits without a limit", () => {
    const a = simulateOnce(single(200, 10), DEFAULT_OPTIONS, 5), b = simulateOnce(single(200, 10), DEFAULT_OPTIONS, 5);
    expect(a).toEqual(b);
    const free = simulate(single(200, 10, 0), { runs: 3 });
    expect(free.resources[0].meanWait.mean).toBe(0);
    expect(free.resources[0].flag).toBe(false);
  });

  it("a second room cuts the wait (what-if)", () => {
    const base = simulate(single(200, 6), { runs: 8, seed: 2 });
    const more = simulate(single(200, 6), { runs: 8, seed: 2, capacity: { room: 2 } });
    expect(base.resources[0].flag).toBe(true);
    expect(more.resources[0].meanWait.mean).toBeLessThan(base.resources[0].meanWait.mean / 3);
    expect(more.resources[0].capacity).toBe(2);
  });

  it("serves urgent patients first", () => {
    const m = single(150, 8);
    m.flows.push({ ...m.flows[0], id: 2, name: "Urgent", perDay: 50, links: [{ ...m.flows[0].links[0], urgent: true }, m.flows[0].links[1]] });
    const s = simulate(m, { runs: 8, seed: 4 });
    const [routine, urgent] = s.flows;
    expect(urgent.meanWait.mean).toBeLessThan(routine.meanWait.mean);
  });

  it("uses lifts and porters only when the floor changes or a patient is moved", () => {
    const m = single(100, 5);
    m.flows[0].steps[2].level = 3;
    m.flows[0].links[1].transport = "BED";
    m.resources.push({ key: "lift", label: "Bed lift", kind: "lift", capacity: 1 }, { key: "porter", label: "Porters", kind: "porter", capacity: 2 });
    m.liftForBeds = "lift"; m.liftForAll = "lift"; m.porter = "porter";
    const s = simulate(m, { runs: 3 });
    const lift = s.resources.find((r) => r.key === "lift")!, porter = s.resources.find((r) => r.key === "porter")!;
    expect(lift.utilisation.mean).toBeGreaterThan(0); expect(porter.utilisation.mean).toBeGreaterThan(0);
    m.flows[0].steps[2].level = 0; m.flows[0].links[1].transport = "FOOT";
    const t = simulate(m, { runs: 3 });
    expect(t.resources.find((r) => r.key === "lift")!.utilisation.mean).toBe(0);
    expect(t.resources.find((r) => r.key === "porter")!.utilisation.mean).toBe(0);
  });

  it("follows the shares and lowers weekend volumes", () => {
    const m = single(240, 1, 0);
    m.flows[0].steps.push({ key: "y", label: "Other", kind: "STEP", minutes: 1, resource: "other", level: 0 });
    m.flows[0].links = [{ from: "s", to: "x", share: 75, transport: "FOOT", urgent: false }, { from: "s", to: "y", share: 25, transport: "FOOT", urgent: false },
      { from: "x", to: "e", share: 100, transport: "FOOT", urgent: false }, { from: "y", to: "e", share: 100, transport: "FOOT", urgent: false }];
    m.resources.push({ key: "other", label: "Other", kind: "room", capacity: 5 });
    const one = simulateOnce(m, { ...DEFAULT_OPTIONS, days: 7, weekendShare: 0.5 }, 9);
    const x = one.resources.room.served, y = one.resources.other.served;
    expect(x).toBe(0); // no limit: not counted
    expect(y / one.flows[1].arrived).toBeGreaterThan(0.2); expect(y / one.flows[1].arrived).toBeLessThan(0.3);
    // 5 weekdays × 240 + 2 weekend days × 120 = 1,440.
    expect(one.flows[1].arrived).toBeGreaterThan(1300); expect(one.flows[1].arrived).toBeLessThan(1580);
  });
});

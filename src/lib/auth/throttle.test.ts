import { describe, expect, it } from "vitest";
import { emailDelay, Throttle } from "./throttle";

describe("Throttle (S4)", () => {
  it("keeps a busy key when the table fills with one-off keys", () => {
    const t = new Throttle({ windowMs: 60_000, maxKeys: 100, now: () => 1 });
    for (let i = 0; i < 7; i++) t.reserve("e:victim", emailDelay);
    for (let i = 0; i < 1000; i++) t.reserve(`e:junk${i}`, emailDelay);
    expect(t.failures("e:victim")).toBe(7);
    expect(t.size).toBeLessThanOrEqual(100);
  });

  it("drops expired keys first and forgets a key after its window", () => {
    let now = 0;
    const t = new Throttle({ windowMs: 1000, maxKeys: 3, now: () => now });
    t.reserve("a", () => 0); t.reserve("b", () => 0);
    now = 5000;
    t.reserve("c", () => 0); t.reserve("d", () => 0);
    expect(t.failures("a")).toBe(0);
    expect(t.failures("c")).toBe(1);
  });

  it("books waits one after another and refuses past the cap", () => {
    const t = new Throttle({ windowMs: 60_000, maxKeys: 10, now: () => 0 });
    const waits = [0, 1, 2].map(() => t.reserve("k", () => 1000, 2500));
    expect(waits.map((w) => [w.wait, w.refused])).toEqual([[1000, false], [2000, false], [0, true]]);
    t.clear("k");
    expect(t.failures("k")).toBe(0);
  });

  it("emailDelay: 5 free, then doubling to 30 s", () => {
    expect([0, 4, 5, 6, 7, 20].map(emailDelay)).toEqual([0, 0, 1000, 2000, 4000, 30_000]);
  });
});

import { describe, expect, it } from "vitest";
import { eventsAt, perDay, shortcutFor, type TimeEvent } from "./timeline";

const ev = (t: string, kind: TimeEvent["kind"] = "fault"): TimeEvent => ({ t, kind, assetId: 1, roomId: 1, text: "" });
const DAY = 86400_000;

describe("time slider", () => {
  const events = [ev("2026-10-01T00:00:00Z"), ev("2026-10-03T00:00:00Z", "repair"), ev("2026-10-05T00:00:00Z")];
  it("shows the events in the trailing window, fading with age", () => {
    const at = Date.parse("2026-10-05T00:00:00Z");
    const shown = eventsAt(events, at, 4 * DAY);
    expect(shown.map((e) => e.t.slice(0, 10))).toEqual(["2026-10-05", "2026-10-03"]);
    expect(shown[0].strength).toBe(1);
    expect(shown[1].strength).toBeCloseTo(0.5);
    expect(eventsAt(events, at, 4 * DAY, new Set(["repair"]))).toHaveLength(1);
  });
  it("counts per day", () => {
    expect(perDay(events, Date.parse("2026-10-01T00:00:00Z"), 5)).toEqual([1, 0, 1, 0, 1]);
  });
});

describe("shortcuts", () => {
  it("maps keys, and ignores typing and modifiers", () => {
    expect(shortcutFor({ key: "3" })).toEqual({ kind: "floor", index: 2 });
    expect(shortcutFor({ key: "F" })).toEqual({ kind: "find" });
    expect(shortcutFor({ key: "?" })).toEqual({ kind: "help" });
    expect(shortcutFor({ key: "r", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "r", target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
    expect(shortcutFor({ key: "r" }, true)).toBeNull(); // R turns a device being dropped
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { group, totalsOf } from "./book-value-calc";

const dev = (costEgp: number | null, bookValueEgp: number | null, state = "DEPRECIATING") =>
  ({ facilityId: 1, costEgp, accumulatedEgp: costEgp != null && bookValueEgp != null ? costEgp - bookValueEgp : null, bookValueEgp, dep: { state } }) as never;

describe("book value left (DL-17)", () => {
  it("is worked out over the devices that could be valued only", () => {
    // One device valued: cost 1000, book 600 (60 % left). One device with a cost but no start date: not worked out.
    const rows = group([dev(1000, 600), dev(1000, null, "NO_START")], () => "1", () => ({}));
    expect(rows[0].pctLeft).toBe(60); // the old code divided by 2000: 30 %
    expect(rows[0].unknown).toBe(1);
    expect(totalsOf(rows, {})?.pctLeft).toBe(60);
  });
});

import { describe, expect, it } from "vitest";
import { calibrationState, instrumentLabel, instrumentsProblem, parseInstrumentIds } from "./test-equipment";

const esa = { id: 7, tag: "DGH-BME-900001", manufacturer: "Fluke Biomedical", model: "ESA615", serial: "5100001", calibrationDue: "2026-12-01" };

describe("test equipment on a maintenance visit", () => {
  it("labels an instrument", () => {
    expect(instrumentLabel(esa)).toBe("Fluke Biomedical ESA615, serial 5100001 (DGH-BME-900001)");
    expect(instrumentLabel({ id: 1, tag: "X-1" })).toBe("X-1 (X-1)");
  });
  it("reads checkbox values", () => {
    expect(parseInstrumentIds(["7", "7", "x", "0", " 9 "])).toEqual([7, 9]);
  });
  it("accepts an instrument in calibration, on the last day too", () => {
    expect(instrumentsProblem([7], [esa], "2026-11-17")).toBeNull();
    expect(instrumentsProblem([7], [esa], "2026-12-01")).toBeNull();
    expect(instrumentsProblem([], [], "2026-11-17")).toBeNull();
  });
  it("refuses one whose calibration ran out before the work", () => {
    expect(instrumentsProblem([7], [esa], "2026-12-02")).toMatch(/calibration ran out on 2026-12-01.*can't be signed off/);
  });
  it("refuses one with no calibration date, or not from this hospital", () => {
    expect(instrumentsProblem([7], [{ ...esa, calibrationDue: null }], "2026-11-17")).toMatch(/no calibration date/);
    expect(instrumentsProblem([7, 8], [esa], "2026-11-17")).toMatch(/this hospital's list/);
  });
  it("shows the state in the picker", () => {
    expect(calibrationState("2026-11-16", "2026-11-17")).toBe("expired");
    expect(calibrationState(null, "2026-11-17")).toBe("none");
    expect(calibrationState("2026-11-17", "2026-11-17")).toBe("ok");
  });
});

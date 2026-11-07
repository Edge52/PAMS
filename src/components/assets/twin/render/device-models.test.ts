import { describe, expect, it } from "vitest";
import { deviceModel } from "./device-models";

describe("device models (wave 16)", () => {
  it("picks the most specific model by catalogue code", () => {
    expect(deviceModel("IMG-CT-128", "IMG-CT", "IMG")).toBe("ct");
    expect(deviceModel("IMG-XR-DR", "IMG-XR", "IMG")).toBe("xray");
    expect(deviceModel("LIF-ANE-WS", "LIF-ANE", "LIF")).toBe("anaesthesia");
    expect(deviceModel("LIF-NEO-INC", "LIF-NEO", "LIF")).toBe("incubator");
    expect(deviceModel("SUR-OR-TABLE", "SUR-OR", "SUR")).toBe("or-table");
    expect(deviceModel("STR-STE-SM", "STR-STE", "STR")).toBe("washer");
    expect(deviceModel("FUR-BED-ICU", "FUR-BED", "FUR")).toBe("bed");
  });
  it("falls back to the device's kind, from the code alone for planned lines", () => {
    expect(deviceModel("RTH-LIN-X", "RTH-LIN", "RTH")).toBe("ct");
    expect(deviceModel("XYZ-ABC-1", "XYZ-ABC", "XYZ")).toBe("cabinet");
    expect(deviceModel("IMG-MRI-15T")).toBe("ct");
    expect(deviceModel("RTH-LIN-6MV")).toBe("ct");
  });
});

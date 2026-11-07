import { describe, expect, it } from "vitest";
import { deviceModel, symbolModel } from "./device-models";

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
    expect(deviceModel("IMG-MRI-15T")).toBe("mri");
    expect(deviceModel("IMG-MRI-OPEN")).toBe("mri-open");
    expect(deviceModel("IMG-XR-CARM", "IMG-XR", "IMG")).toBe("carm");
    expect(deviceModel("RTH-LIN-6MV")).toBe("ct");
  });
  it("draws symbols read from a drawing", () => {
    expect(symbolModel({ kind: "furniture", code: "FUR-BED", label: "Bed" })).toBe("bed");
    expect(symbolModel({ kind: "equipment", code: "IMG-CT", label: "CT scanner" })).toBe("ct");
    expect(symbolModel({ kind: "sanitary", code: null, label: "WC" })).toBe("wc");
    expect(symbolModel({ kind: "sanitary", code: null, label: "Basin or sink" })).toBe("basin");
    expect(symbolModel({ kind: "furniture", code: null, label: "Chair" })).toBe("chair");
    expect(symbolModel({ kind: "outlet", code: "GAS-O2", label: "Oxygen outlet" })).toBe(null);
  });
});

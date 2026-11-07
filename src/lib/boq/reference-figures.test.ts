import { describe, expect, it } from "vitest";
import { referenceRows } from "./reference-figures";

describe("reference figures register", () => {
  const rows = referenceRows();
  it("covers every benchmark, room need, running-cost group and lead time, with unique ids", () => {
    expect(rows.length).toBeGreaterThan(50);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });
  it("shows the reviewed values the app now uses", () => {
    const v = (id: string) => rows.find((r) => r.id === id)!;
    expect(v("bench:ICU:LIF-VEN-ICU")).toMatchObject({ value: "0.8–1.2 per bed", status: "adjusted", previous: "0.5–1.2" });
    expect(v("room:IMG-MRI")).toMatchObject({ value: "30 m²", status: "adjusted" });
    expect(v("room:SUR-OR-TABLE").value).toBe("37 m²");
    expect(v("lead:IMG-CT")).toMatchObject({ value: "6 months", status: "adjusted" });
  });
  it("keeps room standards' areas the same as the room needs used in BOQ checks", async () => {
    const { ROOM_NEEDS } = await import("./room-requirements");
    const { standardFor } = await import("../assets/room-standards");
    for (const [name, prefix] of [["MRI", "IMG-MRI"], ["CT", "IMG-CT"], ["Theatre", "SUR-OR-TABLE"], ["X-ray", "IMG-XR-DR"], ["Mammography", "IMG-MAM"], ["Cath lab", "IMG-ANG"]] as const)
      expect(standardFor(name, null)?.rule.spec.minAreaM2, name).toBe(ROOM_NEEDS.find((n) => n.prefix === prefix)!.minArea);
    expect(rows.some((r) => r.id === "roomstd:Operating theatre")).toBe(true);
  });
  it("gives every sourced or adjusted figure at least one source", () => {
    for (const r of rows.filter((x) => x.status !== "judgement")) expect(r.sources.length, r.id).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { cleanLegalName } from "./legal-names";

describe("cleanLegalName", () => {
  it("blank means none", () => {
    expect(cleanLegalName("")).toEqual({ ok: true, value: null });
    expect(cleanLegalName("   ")).toEqual({ ok: true, value: null });
    expect(cleanLegalName(null)).toEqual({ ok: true, value: null });
  });
  it("keeps Arabic, collapses spaces and drops direction marks", () => {
    expect(cleanLegalName("  شركة   النيل‏ للأجهزة الطبية ")).toEqual({ ok: true, value: "شركة النيل للأجهزة الطبية" });
    expect(cleanLegalName("جي إي هيلث كير GE (ش.م.م)")).toEqual({ ok: true, value: "جي إي هيلث كير GE (ش.م.م)" });
  });
  it("refuses a name without Arabic letters", () => {
    expect(cleanLegalName("Nile Medical").ok).toBe(false);
    expect(cleanLegalName("123").ok).toBe(false);
  });
  it("refuses a very long name", () => {
    expect(cleanLegalName("ش".repeat(301)).ok).toBe(false);
  });
});

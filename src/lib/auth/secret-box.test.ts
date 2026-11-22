import { describe, expect, it } from "vitest";
import { canSeal, isSealed, openSecret, sealSecret } from "./secret-box";

const S = "a-long-app-secret-of-at-least-32-characters!";

describe("two-step secrets at rest (S13)", () => {
  it("are sealed with APP_SECRET and open again", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", S);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(openSecret(sealed, S)).toBe("JBSWY3DPEHPK3PXP");
    expect(sealSecret("JBSWY3DPEHPK3PXP", S)).not.toBe(sealed); // fresh IV each time
  });
  it("can't be opened with another or no APP_SECRET, or when tampered with", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", S);
    expect(openSecret(sealed, S + "x")).toBeNull();
    expect(openSecret(sealed, undefined)).toBeNull();
    expect(openSecret(sealed.slice(0, -4) + "AAAA", S)).toBeNull();
  });
  it("leave things as they were without APP_SECRET, and old plain secrets still open", () => {
    expect(sealSecret("JBSWY3DPEHPK3PXP", undefined)).toBe("JBSWY3DPEHPK3PXP");
    expect(sealSecret("JBSWY3DPEHPK3PXP", "short")).toBe("JBSWY3DPEHPK3PXP");
    expect(openSecret("JBSWY3DPEHPK3PXP", S)).toBe("JBSWY3DPEHPK3PXP");
    expect(canSeal(undefined)).toBe(false);
    expect(canSeal(S)).toBe(true);
  });
});

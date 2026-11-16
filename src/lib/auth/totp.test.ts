import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeAt, newBackupCodes, newSecret, normalBackupCode, otpauthUrl, stepOf, verifyCode } from "./totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890" (the 8-digit test values, last 6 digits).
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("two-step codes (wave 25)", () => {
  it("matches the RFC 6238 test values", () => {
    expect(codeAt(SECRET, stepOf(59_000))).toBe("287082");
    expect(codeAt(SECRET, stepOf(1111111109_000))).toBe("081804");
    expect(codeAt(SECRET, stepOf(1234567890_000))).toBe("005924");
    expect(codeAt(SECRET, stepOf(20000000000_000))).toBe("353130");
  });
  it("base32 round-trips", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
    expect(base32Decode(newSecret())).toHaveLength(20);
  });
  it("accepts the current code and one step either side, nothing else", () => {
    const now = 1234567890_000, s = stepOf(now);
    expect(verifyCode(SECRET, "005924", now)).toBe(s);
    expect(verifyCode(SECRET, " 005 924 ", now)).toBe(s);
    expect(verifyCode(SECRET, codeAt(SECRET, s - 1), now)).toBe(s - 1);
    expect(verifyCode(SECRET, codeAt(SECRET, s + 1), now)).toBe(s + 1);
    expect(verifyCode(SECRET, codeAt(SECRET, s - 2), now)).toBeNull();
    expect(verifyCode(SECRET, "12345", now)).toBeNull();
    expect(verifyCode(SECRET, "abcdef", now)).toBeNull();
  });
  it("refuses a code that was already used", () => {
    const now = 1234567890_000, s = stepOf(now);
    expect(verifyCode(SECRET, "005924", now, s)).toBeNull();
    expect(verifyCode(SECRET, "005924", now, s - 1)).toBe(s);
  });
  it("builds the authenticator link and backup codes", () => {
    expect(otpauthUrl("ABC", "a@b.c")).toBe("otpauth://totp/Hospital%20PAMS%3Aa%40b.c?secret=ABC&issuer=Hospital%20PAMS&algorithm=SHA1&digits=6&period=30");
    const codes = newBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normalBackupCode(" ABCD-2345 ")).toBe("abcd2345");
  });
});

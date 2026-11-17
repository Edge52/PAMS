import { describe, expect, it } from "vitest";
import { contentPolicy, fixedHeaders } from "./security-headers";

describe("security headers (wave 25)", () => {
  it("lets only nonce scripts run and nothing from other sites", () => {
    const p = contentPolicy("abc123");
    expect(p).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("form-action 'self'");
    expect(p).not.toContain("unsafe-eval");
    // The only outside addresses are the two the fonts come from.
    expect(p.match(/https?:\/\/[^ ;]+/g)).toEqual(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    expect(p.split("; ").find((d) => d.startsWith("script-src"))).not.toContain("unsafe-inline");
  });
  it("allows eval and the reload socket only in development", () => {
    expect(contentPolicy("n", true)).toContain("'unsafe-eval'");
    expect(contentPolicy("n", true)).toContain("ws:");
  });
  it("adds HSTS only over HTTPS", () => {
    expect(fixedHeaders(false).map(([k]) => k)).not.toContain("Strict-Transport-Security");
    expect(fixedHeaders(true).map(([k]) => k)).toContain("Strict-Transport-Security");
    expect(Object.fromEntries(fixedHeaders(false))["X-Frame-Options"]).toBe("DENY");
  });
  it("loads equipment model files only from the app itself (wave 28)", () => {
    // The 3D view fetches .glb files from /files/equipment_model/… with fetch: connect-src must stay the app's own.
    expect(contentPolicy("n").split("; ").find((d) => d.startsWith("connect-src"))).toBe("connect-src 'self'");
  });
});

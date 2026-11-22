import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { authorizeUrl, exchangeCode, pkcePair } from "./supabase";

describe("Supabase sign-in", () => {
  it("makes a PKCE pair and the authorize link", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const u = new URL(authorizeUrl({ url: "https://x.supabase.co" }, "azure", "https://pams.example/auth/callback", challenge));
    expect(u.pathname).toBe("/auth/v1/authorize");
    expect(u.searchParams.get("provider")).toBe("azure");
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
    expect(u.searchParams.get("scopes")).toBe("email");
  });
});

describe("matching the signed-in person (S15)", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_AZURE_TENANTS; });
  const answer = (user: object) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ user }), { status: 200 }));
  const run = () => exchangeCode({ url: "https://x.supabase.co", key: "k" }, "code", "verifier");
  const azure = (data: object, extra: object = {}) => ({
    email: "Dr.Ali@Hospital.eg", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "azure" },
    identities: [{ provider: "azure", identity_data: { email: "dr.ali@hospital.eg", email_verified: true, tid: "TENANT-1", sub: "abc", ...data } }], ...extra,
  });

  it("accepts a confirmed, verified Microsoft account", async () => {
    answer(azure({}));
    expect(await run()).toEqual({ email: "dr.ali@hospital.eg" });
  });

  it("refuses an address Supabase hasn't confirmed, even when the field is missing", async () => {
    answer(azure({}, { email_confirmed_at: undefined }));
    expect(await run()).toHaveProperty("error");
  });

  it("refuses a Microsoft account whose email isn't verified, or is a different address", async () => {
    answer(azure({ email_verified: false }));
    expect(await run()).toHaveProperty("error");
    answer(azure({ email: "someone.else@hospital.eg" }));
    expect(await run()).toHaveProperty("error");
  });

  it("keeps Microsoft sign-in to the hospital's tenants when they are listed", async () => {
    process.env.SUPABASE_AZURE_TENANTS = "tenant-1";
    answer(azure({}));
    expect(await run()).toEqual({ email: "dr.ali@hospital.eg" });
    answer(azure({ tid: "other" }));
    expect(await run()).toHaveProperty("error");
  });
});

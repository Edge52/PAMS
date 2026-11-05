import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { authorizeUrl, pkcePair } from "./supabase";

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

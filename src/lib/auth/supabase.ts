/**
 * Sign-in through Supabase Auth (wave 13): Microsoft, Google or an emailed link, with PKCE. Supabase only proves who
 * the person is; they get in only if an active PAMS user has the same email, with that user's role and hospitals.
 * Password sign-in stays. Configure with SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_PROVIDERS (e.g. "azure,google"),
 * and optionally SUPABASE_AZURE_TENANTS (the hospital's Microsoft tenant ids).
 */
import { createHash, randomBytes } from "node:crypto";

export const PROVIDER_LABELS: Record<string, string> = { azure: "Microsoft", google: "Google" };

export function supabaseConfig(): { url: string; key: string; providers: string[] } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, ""), key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const providers = (process.env.SUPABASE_PROVIDERS ?? "azure,google").split(",").map((p) => p.trim()).filter((p) => p in PROVIDER_LABELS);
  return { url, key, providers };
}

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(cfg: { url: string }, provider: string, redirectTo: string, challenge: string): string {
  const u = new URL(`${cfg.url}/auth/v1/authorize`);
  u.searchParams.set("provider", provider);
  u.searchParams.set("redirect_to", redirectTo);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "s256");
  if (provider === "azure") u.searchParams.set("scopes", "email");
  return u.toString();
}

type TokenUser = {
  email?: string; email_confirmed_at?: string | null;
  app_metadata?: { provider?: string };
  identities?: { provider?: string; identity_data?: { email?: string; email_verified?: boolean; tid?: string; sub?: string } }[];
};

/**
 * S15: the email we may match a PAMS user on, or why not. Supabase must have confirmed the address, and the identity
 * the person signed in with must not say otherwise: its email, when given, is the same and not marked unverified.
 * For Microsoft, when SUPABASE_AZURE_TENANTS lists tenant ids, the account must belong to one of them. Pure.
 */
export function signedInEmail(user: TokenUser | undefined, azureTenants: string[] = []): { email: string } | { error: string } {
  const email = user?.email?.trim().toLowerCase();
  if (!email) return { error: "Sign-in wasn't completed." };
  if (!user?.email_confirmed_at) return { error: "That email address isn't confirmed yet." };
  const provider = user.app_metadata?.provider;
  const id = user.identities?.find((i) => i.provider === provider)?.identity_data;
  if (provider && provider !== "email" && !id) return { error: "Sign-in wasn't completed." };
  if (id?.email && id.email.trim().toLowerCase() !== email) return { error: "The account you signed in with has a different email address." };
  if (id?.email_verified === false) return { error: `${PROVIDER_LABELS[provider ?? ""] ?? "That account"} hasn't verified this email address.` };
  if (provider === "azure" && azureTenants.length && !(id?.tid && azureTenants.includes(id.tid.toLowerCase()))) {
    return { error: "Sign in with your hospital's Microsoft account." };
  }
  return { email };
}

/** Microsoft tenant ids allowed to sign in (SUPABASE_AZURE_TENANTS, comma separated); empty = any. */
export function azureTenants(): string[] {
  return (process.env.SUPABASE_AZURE_TENANTS ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

/** Exchange the code for the signed-in person's verified email, or an error to show. */
export async function exchangeCode(cfg: { url: string; key: string }, code: string, verifier: string): Promise<{ email: string } | { error: string }> {
  const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST", headers: { apikey: cfg.key, "content-type": "application/json" }, body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  }).catch(() => null);
  if (!res) return { error: "Supabase couldn't be reached. Try again, or sign in with your password." };
  const body = (await res.json().catch(() => ({}))) as { user?: TokenUser; error_description?: string; msg?: string };
  if (!res.ok || !body.user?.email) return { error: body.error_description ?? body.msg ?? "Sign-in wasn't completed." };
  return signedInEmail(body.user, azureTenants());
}

/** Start signing in with Microsoft or Google through Supabase Auth (wave 13). */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeLocalPath } from "@/lib/safe-path";
import { authorizeUrl, pkcePair, supabaseConfig } from "@/lib/auth/supabase";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const cfg = supabaseConfig();
  const provider = (await params).provider;
  const base = process.env.APP_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  if (!cfg || !cfg.providers.includes(provider)) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("That sign-in option isn't set up.")}`);
  const next = safeLocalPath(new URL(req.url).searchParams.get("next")) ?? "/";
  const { verifier, challenge } = pkcePair();
  (await cookies()).set("hpams_pkce", JSON.stringify({ v: verifier, n: next.startsWith("/login") ? "/" : next }), {
    httpOnly: true, sameSite: "lax", secure: base.startsWith("https://"), path: "/auth/callback", maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(cfg, provider, `${base}/auth/callback`, challenge));
}

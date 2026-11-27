import { NextResponse, type NextRequest } from "next/server";
import { contentPolicy, fixedHeaders } from "@/lib/security-headers";

/**
 * Two jobs on every request:
 * - Optimistic sign-in check: no session cookie → the sign-in page. The real check (is the session valid, may this
 *   user do this?) happens in pages and server actions via lib/auth/session.
 * - Security headers (wave 25): a content policy with a one-time nonce, and the fixed headers.
 */
// Wave 39: /api/health answers Docker's health check without a session (it shows nothing secret).
// Wave 41: /api/v1 is the read-only API: it never uses the session cookie; each route checks its bearer token
// (lib/api/api-server.ts apiGet), so a signed-in browser can't read it by its cookie either.
const PUBLIC = ["/login", "/setup", "/auth/sso", "/auth/callback", "/api/health", "/api/v1"];
const HTTPS = (process.env.APP_URL ?? "").startsWith("https://");
const DEV = process.env.NODE_ENV !== "production";

function secure(res: NextResponse, policy: string): NextResponse {
  res.headers.set("Content-Security-Policy", policy);
  for (const [k, v] of fixedHeaders(HTTPS)) res.headers.set(k, v);
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const policy = contentPolicy(nonce, DEV);
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isPublic && !req.cookies.has("hpams_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return secure(NextResponse.redirect(url), policy);
  }
  // Next.js reads the policy from the request to put the nonce on its own script tags.
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  return secure(NextResponse.next({ request: { headers } }), policy);
}

export const config = {
  // Everything except Next's own assets, the favicon and the install files.
  // Wave 26: the install files (manifest, icons) are public too, so a phone can read them before signing in.
  // Wave 39: so is the offline helper (sw.js), so the browser can check it for updates while signed out.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-icon.png|icons/|sw.js).*)"],
};

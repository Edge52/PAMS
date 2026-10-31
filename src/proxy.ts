import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic sign-in check: no session cookie → the sign-in page. The real check (is the session valid, may this
 * user do this?) happens in pages and server actions via lib/auth/session.
 */
const PUBLIC = ["/login", "/setup"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.cookies.has("hpams_session")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

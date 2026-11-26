/**
 * Wave 39: server errors for Administration › System errors. Pure — turns what Next.js hands to onRequestError
 * (src/instrumentation.ts) into one row, and leaves out what isn't an error (redirects, "not found").
 */

export type ErrorEntry = { path: string | null; route: string | null; method: string | null; kind: string | null; message: string; digest: string | null; stack: string | null };

/** Next.js throws these on purpose (redirect(), notFound(), forbidden(), dynamic rendering bail-outs). */
const CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/;

export const KEEP_DAYS = 90;

/** Hide passwords in connection strings and bearer tokens, in case a driver puts them in a message. */
export function scrub(text: string): string {
  return text
    .replace(/(\w+:\/\/[^:/\s@]+:)[^@\s]+@/g, "$1***@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 ***")
    .replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1***");
}

export function errorEntry(err: unknown, request: { path?: string; method?: string } | null, context: { routePath?: string; routeType?: string } | null): ErrorEntry | null {
  const e = err as { message?: unknown; digest?: unknown; stack?: unknown } | null;
  const digest = e && typeof e === "object" && e.digest != null ? String(e.digest) : null;
  if (digest && CONTROL_FLOW.test(digest)) return null;
  const message = err instanceof Error ? err.message : e && typeof e === "object" && typeof e.message === "string" ? e.message : String(err);
  if (CONTROL_FLOW.test(message)) return null;
  const stack = e && typeof e === "object" && typeof e.stack === "string" ? e.stack : null;
  const path = request?.path ? request.path.split("?")[0].slice(0, 500) : null;
  return {
    path, route: context?.routePath?.slice(0, 500) ?? null, method: request?.method?.slice(0, 12) ?? null, kind: context?.routeType?.slice(0, 16) ?? null,
    message: scrub(message || "Unknown error").slice(0, 2000), digest: digest?.slice(0, 64) ?? null, stack: stack ? scrub(stack).slice(0, 8000) : null,
  };
}

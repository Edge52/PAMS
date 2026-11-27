import "server-only";
/**
 * Read-only API (wave 41), database side: token check, scope, hospitals, rate limit and the call log. Every route
 * under /api/v1 answers through `apiGet`, which never uses the browser session (src/proxy.ts lets /api/v1 through
 * without one; the token is the only key).
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiCalls, apiTokens, facilities } from "@/db/schema";
import { clientAddress, trustProxy } from "@/lib/client-address";
import { bearer, hashToken, hasScope, RATE_PER_MINUTE, tokenProblem, tokenScope, type Scope } from "./tokens";

export type ApiCtx = { tokenId: number; scope: number[] | null; prices: boolean; sp: URLSearchParams };
type Out = { body: unknown; rows?: number };

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

async function log(tokenId: number | null, path: string, status: number, rows: number | null, ip: string | null) {
  try { await db.insert(apiCalls).values({ tokenId, path: path.slice(0, 500), status, rows, ip }); } catch { /* the log must not stop the answer */ }
}

/** Answer a GET with the token's checks; `fn` reads the data within `ctx.scope`. */
export async function apiGet(req: Request, need: Scope, fn: (ctx: ApiCtx) => Promise<Out>): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const ip = clientAddress(req.headers, trustProxy());
  const raw = bearer(req.headers.get("authorization"));
  if (!raw) { await log(null, path, 401, null, ip); return json(401, { error: "Send the token as: Authorization: Bearer hpk_…" }, { "WWW-Authenticate": "Bearer" }); }
  const [t] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashToken(raw))).limit(1);
  const now = new Date();
  const problem = tokenProblem(t, now);
  if (problem || !t) { await log(t?.id ?? null, path, 401, null, ip); return json(401, { error: problem }, { "WWW-Authenticate": "Bearer" }); }
  if (!hasScope(t, need)) { await log(t.id, path, 403, null, ip); return json(403, { error: `This token may not read this (needs ${need}).` }); }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(apiCalls)
    .where(and(eq(apiCalls.tokenId, t.id), gt(apiCalls.at, new Date(now.getTime() - 60_000))));
  if (Number(n) >= RATE_PER_MINUTE) { await log(t.id, path, 429, null, ip); return json(429, { error: `At most ${RATE_PER_MINUTE} calls a minute. Wait and try again.` }, { "Retry-After": "60" }); }
  // ?facility=DGH,LPH narrows to those hospitals (within the token's own list).
  let asked: number[] | null = null;
  const codes = (url.searchParams.get("facility") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  if (codes.length) {
    const rows = await db.select({ id: facilities.id, code: facilities.code }).from(facilities).where(inArray(sql`upper(${facilities.code})`, codes));
    if (rows.length !== codes.length) { await log(t.id, path, 400, null, ip); return json(400, { error: "Unknown hospital code in ?facility=." }); }
    asked = rows.map((r) => r.id);
  }
  try {
    const out = await fn({ tokenId: t.id, scope: tokenScope(t.facilityIds, asked), prices: hasScope(t, "prices:read"), sp: url.searchParams });
    await Promise.all([log(t.id, path, 200, out.rows ?? null, ip), db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, t.id))]);
    return json(200, out.body);
  } catch (e) {
    const bad = e instanceof ApiInputError;
    await log(t.id, path, bad ? 400 : 500, null, ip);
    if (bad) return json(400, { error: e.message });
    throw e;
  }
}

/** A bad query parameter: answered as 400 with the message. */
export class ApiInputError extends Error {}

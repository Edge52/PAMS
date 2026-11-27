/**
 * Read-only API (wave 41): tokens, scopes, paging and price hiding. Pure.
 *
 * An administrator makes a token with a name, scopes, an expiry and optionally a list of hospitals. The token is
 * shown once; only its SHA-256 is stored. A call sends it as `Authorization: Bearer hpk_…`. Every call is logged and
 * a token may make RATE_PER_MINUTE calls a minute.
 */
import { createHash, randomBytes } from "node:crypto";

export const SCOPES = ["assets:read", "workorders:read", "ppm:read", "analytics:read", "prices:read"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = {
  "assets:read": "Asset register", "workorders:read": "Work orders", "ppm:read": "Planned maintenance visits",
  "analytics:read": "Key figures", "prices:read": "Prices and costs (with the scopes above)",
};

export const TOKEN_PREFIX = "hpk_";
export const RATE_PER_MINUTE = 60;
export const MAX_PER_PAGE = 200;
export const MAX_DAYS = 366;

/** A new random token and what is stored for it. */
export function newToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) };
}

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** The token from an Authorization header ("Bearer hpk_…"), or null. */
export function bearer(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m && m[1].startsWith(TOKEN_PREFIX) && m[1].length <= 100 ? m[1] : null;
}

export type TokenRow = { scopes: string[]; expiresAt: Date; revokedAt: Date | null; facilityIds: number[] | null };

/** Why a stored token may not be used now, or null. */
export function tokenProblem(t: TokenRow | null | undefined, now: Date): string | null {
  if (!t) return "Unknown token.";
  if (t.revokedAt) return "This token has been revoked.";
  if (t.expiresAt.getTime() <= now.getTime()) return "This token has expired.";
  return null;
}

export const hasScope = (t: Pick<TokenRow, "scopes">, s: Scope) => t.scopes.includes(s);

/**
 * Hospitals the token may read: its own list (null = every hospital), narrowed by `?facility=` codes when given.
 * Returns null for "every hospital", or an id list (empty = nothing).
 */
export function tokenScope(tokenFacilities: number[] | null, asked: number[] | null): number[] | null {
  if (!asked) return tokenFacilities;
  return tokenFacilities ? asked.filter((id) => tokenFacilities.includes(id)) : asked;
}

/** `?page=` and `?perPage=` (default 50, at most 200). Bad values fall back to the defaults. */
export function paging(sp: URLSearchParams): { page: number; perPage: number; offset: number } {
  const int = (v: string | null, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  const page = Math.max(1, Math.min(100000, int(sp.get("page"), 1)));
  const perPage = Math.max(1, Math.min(MAX_PER_PAGE, int(sp.get("perPage"), 50)));
  return { page, perPage, offset: (page - 1) * perPage };
}

/** The page envelope: data, page, perPage, total and the next page's number (null on the last). */
export function pageOf<T>(data: T[], total: number, p: { page: number; perPage: number }) {
  return { data, page: p.page, perPage: p.perPage, total, next: p.page * p.perPage < total ? p.page + 1 : null };
}

/** Drop money fields unless the token has prices:read. */
export function withoutPrices<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[], prices: boolean): T[] {
  if (prices) return rows;
  return rows.map((r) => { const o = { ...r }; for (const k of keys) delete o[k]; return o; });
}

/** What is wrong with a token request from the admin form, by field, or {}. */
export function tokenFormProblems(f: { name: string; scopes: string[]; days: number }): Record<string, string> {
  const out: Record<string, string> = {};
  if (!f.name.trim()) out.name = "Give the token a name that says who uses it.";
  const real = f.scopes.filter((s) => s !== "prices:read");
  if (!real.length) out.scopes = "Choose at least one thing the token may read.";
  if (f.scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) out.scopes = "Unknown scope.";
  if (!Number.isInteger(f.days) || f.days < 1 || f.days > MAX_DAYS) out.days = `A token lasts 1 to ${MAX_DAYS} days.`;
  return out;
}

/** A date or time filter (`?updatedSince=`): ISO date or date-time, or null when absent or unreadable. */
export function sinceParam(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

"use server";
/** Wave 41: read-only API tokens. Administrators only (`settings.manage`). The token is shown once, in the result. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { apiTokens, facilities } from "@/db/schema";
import { requirePermission } from "@/lib/auth/session";
import { newToken, tokenFormProblems } from "@/lib/api/tokens";
import { fail, ok, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

export type TokenState = (ActionState & { token?: string }) | null;

export async function createApiTokenAction(_: TokenState, fd: FormData): Promise<TokenState> {
  const me = await requirePermission("settings.manage");
  const name = String(fd.get("name") ?? "").trim().slice(0, 120);
  const scopes = fd.getAll("scopes").map(String);
  const days = Number(fd.get("days") ?? 0);
  const bad = tokenFormProblems({ name, scopes, days });
  if (Object.keys(bad).length) return { errors: Object.values(bad), fields: bad };
  const ids = fd.getAll("facilityIds").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const known = ids.length ? (await db.select({ id: facilities.id }).from(facilities)).map((f) => f.id) : [];
  if (ids.some((id) => !known.includes(id))) return fail("Unknown hospital.");
  const t = newToken();
  const [row] = await db.insert(apiTokens).values({
    name, prefix: t.prefix, tokenHash: t.hash, scopes: [...new Set(scopes)], facilityIds: ids.length ? [...new Set(ids)] : null,
    expiresAt: new Date(Date.now() + days * 86_400_000), createdById: me.id, createdByName: me.name,
  }).returning({ id: apiTokens.id });
  await logActivity("api_token", row.id, "created", `API token "${name}" made: ${scopes.join(", ")}, ${days} days${ids.length ? `, ${ids.length} hospital(s)` : ", every hospital"}`, me.name);
  revalidatePath("/admin/api");
  return { message: "Token made. Copy it now: it is not shown again.", token: t.token };
}

export async function revokeApiTokenAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("settings.manage");
  const id = Number(fd.get("id"));
  const [t] = Number.isInteger(id) ? await db.select({ id: apiTokens.id, name: apiTokens.name, revokedAt: apiTokens.revokedAt }).from(apiTokens).where(eq(apiTokens.id, id)) : [];
  if (!t) return fail("That token no longer exists.");
  if (t.revokedAt) return ok("Already revoked.");
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, t.id));
  await logActivity("api_token", t.id, "revoked", `API token "${t.name}" revoked`, me.name);
  revalidatePath("/admin/api");
  return ok("Token revoked. Calls with it are refused from now on.");
}

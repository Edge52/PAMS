import "server-only";
/** Saved filters (wave 41): loading a page's list for one user. Writes are in ./saved-filters-actions. */
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { savedFilters, users } from "@/db/schema";
import type { CurrentUser } from "./auth/session";
import { MAX_SAVED_PER_PAGE, type SavedFilterKey } from "./saved-filters";

export type SavedFilterRow = { id: number; name: string; path: string; query: string; shared: boolean; mine: boolean; owner: string | null };

/** The user's own filters for `page`, then those others shared with the user's role (bounded). */
export async function listSavedFilters(me: Pick<CurrentUser, "id" | "role">, page: SavedFilterKey): Promise<SavedFilterRow[]> {
  const rows = await db.select({
    id: savedFilters.id, name: savedFilters.name, path: savedFilters.path, query: savedFilters.query,
    sharedRole: savedFilters.sharedRole, userId: savedFilters.userId, owner: users.name,
  }).from(savedFilters).leftJoin(users, eq(users.id, savedFilters.userId))
    .where(and(eq(savedFilters.page, page), or(eq(savedFilters.userId, me.id), eq(savedFilters.sharedRole, me.role))))
    .orderBy(asc(savedFilters.name)).limit(MAX_SAVED_PER_PAGE * 3);
  const mine = rows.filter((r) => r.userId === me.id);
  const others = rows.filter((r) => r.userId !== me.id).slice(0, MAX_SAVED_PER_PAGE);
  return [...mine, ...others].map((r) => ({
    id: r.id, name: r.name, path: r.path, query: r.query, shared: r.sharedRole != null, mine: r.userId === me.id, owner: r.owner ?? null,
  }));
}

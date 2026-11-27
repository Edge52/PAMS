"use server";
/**
 * Saved filters (wave 41): save, share and remove a named filter on a list page. Each action needs the permission
 * that opens the page. A user changes and removes only their own filters.
 */
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { savedFilters } from "@/db/schema";
import { requirePermission } from "./auth/session";
import { cleanName, cleanQuery, isSavedFilterKey, MAX_SAVED_PER_PAGE, pathAllowed, SAVED_FILTER_PAGES } from "./saved-filters";
import { listSavedFilters, type SavedFilterRow } from "./saved-filters-server";
import { logActivity } from "./server-utils";

export type SavedFilterResult = { ok?: string; error?: string; list?: SavedFilterRow[] };

const SaveSchema = z.object({
  page: z.string().refine(isSavedFilterKey, "Unknown list."),
  path: z.string().max(200),
  name: z.string().max(200),
  query: z.string().max(4000),
  share: z.boolean().default(false),
});

/** Save the current filter under a name (the same name again replaces it). `share` shows it to the user's role. */
export async function saveFilterAction(input: { page: string; path: string; name: string; query: string; share?: boolean }): Promise<SavedFilterResult> {
  const p = SaveSchema.safeParse(input);
  if (!p.success || !isSavedFilterKey(p.data.page)) return { error: "Unknown list." };
  const page = p.data.page;
  const me = await requirePermission(SAVED_FILTER_PAGES[page].need);
  if (!pathAllowed(page, p.data.path)) return { error: "This page has no saved filters." };
  const name = cleanName(p.data.name);
  if (!name) return { error: "Give the filter a short name (up to 40 characters)." };
  const query = cleanQuery(p.data.query);
  if (query == null) return { error: "This filter is too long to save." };
  if (!query) return { error: "Choose a filter first." };
  const [{ n }] = await db.select({ n: count() }).from(savedFilters).where(and(eq(savedFilters.userId, me.id), eq(savedFilters.page, page)));
  const [same] = await db.select({ id: savedFilters.id }).from(savedFilters)
    .where(and(eq(savedFilters.userId, me.id), eq(savedFilters.page, page), eq(savedFilters.name, name))).limit(1);
  if (!same && n >= MAX_SAVED_PER_PAGE) return { error: `You can keep up to ${MAX_SAVED_PER_PAGE} filters here. Remove one first.` };
  const values = { path: p.data.path, query, sharedRole: p.data.share ? me.role : null, updatedAt: new Date() };
  await db.insert(savedFilters).values({ userId: me.id, page, name, ...values })
    .onConflictDoUpdate({ target: [savedFilters.userId, savedFilters.page, savedFilters.name], set: values });
  await logActivity("user", me.id, "saved filter", `Saved filter "${name}" on ${SAVED_FILTER_PAGES[page].label}${p.data.share ? " (shared with the role)" : ""}`, me.name);
  return { ok: `Saved "${name}".`, list: await listSavedFilters(me, page) };
}

/** Remove one of your own saved filters. */
export async function deleteFilterAction(input: { page: string; id: number }): Promise<SavedFilterResult> {
  if (!isSavedFilterKey(input?.page)) return { error: "Unknown list." };
  const page = input.page;
  const me = await requirePermission(SAVED_FILTER_PAGES[page].need);
  const id = Number(input.id);
  if (!Number.isInteger(id) || id <= 0) return { error: "Choose a saved filter." };
  const gone = await db.delete(savedFilters).where(and(eq(savedFilters.id, id), eq(savedFilters.userId, me.id), eq(savedFilters.page, page)))
    .returning({ name: savedFilters.name });
  if (gone.length === 0) return { error: "You can only remove your own saved filters." };
  await logActivity("user", me.id, "saved filter", `Removed filter "${gone[0].name}" on ${SAVED_FILTER_PAGES[page].label}`, me.name);
  return { ok: `Removed "${gone[0].name}".`, list: await listSavedFilters(me, page) };
}

import { Suspense } from "react";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { SAVED_FILTER_PAGES, type SavedFilterKey } from "@/lib/saved-filters";
import { listSavedFilters, type SavedFilterRow } from "@/lib/saved-filters-server";
import { SavedFiltersBar } from "./saved-filters-bar";

/**
 * Saved filters for a list page (wave 41, server side; wave 21 kept them in the browser). Shows the user's own
 * filters for `page` and those shared with their role as chips, with "Save this filter" for the current address.
 * Put it on a list page whose filters live in the address; `page` is a key of SAVED_FILTER_PAGES.
 */
export async function SavedFilters({ page }: { page: SavedFilterKey }) {
  const me = await getCurrentUser();
  if (!me || !can(me.role, SAVED_FILTER_PAGES[page].need)) return null;
  let saved: SavedFilterRow[] = [];
  // Until the wave 41 migration has run the table is missing: show the bar without saved filters, don't break the list.
  try { saved = await listSavedFilters(me, page); } catch { saved = []; }
  return <Suspense fallback={null}><SavedFiltersBar page={page} initial={saved} /></Suspense>;
}

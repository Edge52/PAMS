/**
 * Wave 41 (agent K): saved list filters, kept on the server per user (optionally shared with the user's role).
 * Re-exported from ./schema at its end.
 *
 * Only lazy references (`() => users.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated.
 */
import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./schema";

/**
 * A named filter on a list page. `page` is a key of SAVED_FILTER_PAGES (src/lib/saved-filters.ts); `path` is the
 * page it opens (the Analytics tabs share one key); `query` is the cleaned query string without "?" or `page`.
 * `sharedRole` set = everyone with that role sees it (only the owner can remove it).
 */
export const savedFilters = pgTable("saved_filters", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  page: text("page").notNull(),
  path: text("path").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull().default(""),
  sharedRole: text("shared_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("saved_filters_user_page_name_uq").on(t.userId, t.page, t.name),
  index("saved_filters_page_role_idx").on(t.page, t.sharedRole),
]);

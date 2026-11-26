/**
 * Wave 39 (agent D): offline work on My jobs. Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => users.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated.
 */
import { index, integer, pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { users, workOrders } from "./schema";

/**
 * Changes a phone sent from its offline queue, by the key the phone gave each one. A change sent twice (the answer
 * was lost on a weak signal) is applied once. Append-only; rules in src/lib/assets/offline-jobs.ts.
 */
export const offlineSyncLog = pgTable("offline_sync_log", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 64 }).notNull(),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.key] }),
  index("offline_sync_log_work_order_idx").on(t.workOrderId),
]);

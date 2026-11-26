/**
 * Wave 40 (agent G): saved capital what-if scenarios for Analytics › Lifecycle. Re-exported from ./schema at its end.
 *
 * Only lazy references (`() => users.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated.
 */
import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { facilities, users } from "./schema";

/**
 * A capital what-if: how the replacement backlog clears under a yearly budget cap. `settings` is cleaned by
 * `cleanSettings()` in src/lib/analytics/capital-whatif.ts ({ delayYears, budgetPerYear, includeTypes }).
 */
export const capitalScenarios = pgTable("capital_scenarios", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull().$type<{ delayYears: number; budgetPerYear: number | null; includeTypes: string[] }>(),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("capital_scenarios_facility_name_uq").on(t.facilityId, t.name),
  index("capital_scenarios_facility_idx").on(t.facilityId),
]);

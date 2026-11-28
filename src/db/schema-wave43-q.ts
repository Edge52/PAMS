/**
 * Wave 43 (agent Q): public holidays, one list for every working-day count (approval reminders, fault targets,
 * contract covered hours, daily imaging QC). Re-exported from ./schema at its very end.
 *
 * Only lazy references to tables in ./schema: this file is loaded while ./schema is still being evaluated.
 * The wave 38 table `public_holidays` (per hospital, contracts only) is still read until its rows are moved here
 * (Setup › Public holidays has a button for it).
 */
import { boolean, date, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { facilities } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/**
 * A public holiday. No hospital = every hospital. `moves` marks a holiday whose date changes each year (Islamic
 * holidays follow the moon); "copy last year" leaves those out.
 */
export const holidays = pgTable("holidays", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  name: text("name").notNull(),
  moves: boolean("moves").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [unique("holidays_facility_day_uq").on(t.facilityId, t.day).nullsNotDistinct(), index("holidays_day_idx").on(t.day)]);

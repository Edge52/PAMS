/**
 * Wave 38 (agent L): official Arabic legal names for formal documents (award, regret and extension letters,
 * committee minutes, the purchase order print). Facilities, departments and device types already have `name_ar`;
 * suppliers and committee members get theirs here, in tables of their own so the existing tables don't change.
 * Re-exported from ./schema at its very end; only lazy references to ./schema tables.
 */
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { committeeMembers, suppliers } from "./schema";

const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/** A supplier's registered name in Arabic, as on its commercial register (one row per supplier, none = not given). */
export const supplierLegalNames = pgTable("supplier_legal_names", {
  supplierId: integer("supplier_id").primaryKey().references(() => suppliers.id, { onDelete: "cascade" }),
  nameAr: text("name_ar").notNull(),
  updatedAt: updatedAt(),
});

/** A committee member's name in Arabic, as in the formation decision. */
export const committeeMemberLegalNames = pgTable("committee_member_legal_names", {
  memberId: integer("member_id").primaryKey().references(() => committeeMembers.id, { onDelete: "cascade" }),
  nameAr: text("name_ar").notNull(),
  updatedAt: updatedAt(),
});

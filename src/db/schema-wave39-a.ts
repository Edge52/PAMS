/**
 * Wave 39 (agent A): Law 182/2018 rules and maintenance strategy evidence. Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => purchaseOrders.id`) to tables in ./schema: this file is loaded while ./schema is still
 * being evaluated. Side tables only; no new columns on purchase_orders, projects or device_types.
 */
import { sql } from "drizzle-orm";
import { boolean, check, integer, numeric, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { deviceTypes, projects, purchaseOrders } from "./schema";

const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/**
 * Delay penalty terms of a purchase order beyond the wave 37 rate and cap (lib/procurement/delay-penalty.ts). No row =
 * supply contract, basis the late items, not waived.
 */
export const poPenaltyTerms = pgTable("po_penalty_terms", {
  poId: integer("po_id").primaryKey().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  /** SUPPLY | SERVICES | WORKS; null = supply. */
  contractType: varchar("contract_type", { length: 16 }),
  /** The late part prevents use of what was delivered: the penalty is on the whole order's value. */
  blocksUse: boolean("blocks_use").notNull().default(false),
  /** Set when the penalty is waived: the reason (required), who recorded it and when. */
  waivedReason: text("waived_reason"),
  waivedByName: text("waived_by_name"),
  waivedAt: timestamp("waived_at", { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [
  check("po_penalty_terms_type_check", sql`${t.contractType} is null or ${t.contractType} in ('SUPPLY', 'SERVICES', 'WORKS')`),
]);

/**
 * Law 182 details of a tender (lib/procurement/timetable.ts, lib/procurement/money.ts). No row = not urgent, bid bond
 * at the legal maximum.
 */
export const projectLawTerms = pgTable("project_law_terms", {
  projectId: integer("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  /** Urgent: the shorter legal minimum days apply. Needs a reason. */
  urgent: boolean("urgent").notNull().default(false),
  urgentReason: text("urgent_reason"),
  /** Bid bond the tender conditions ask for, in the project currency (at most 1.5 % of the estimated value). Null = 1.5 %. */
  bidBondAmount: numeric("bid_bond_amount", { precision: 14, scale: 2 }),
  updatedAt: updatedAt(),
}, (t) => [
  check("project_law_terms_urgent_check", sql`not ${t.urgent} or ${t.urgentReason} is not null`),
  check("project_law_terms_bond_check", sql`${t.bidBondAmount} is null or ${t.bidBondAmount} >= 0`),
]);

/**
 * Evidence and risk basis for a device type's maintenance strategy (CMS S&C 14-07: an alternative maintenance
 * programme must rest on evidence). Required for the hospital's own schedule (ALTERNATIVE).
 */
export const strategyEvidence = pgTable("strategy_evidence", {
  deviceTypeId: integer("device_type_id").primaryKey().references(() => deviceTypes.id, { onDelete: "cascade" }),
  evidence: text("evidence").notNull(),
  updatedByName: text("updated_by_name"),
  updatedAt: updatedAt(),
});

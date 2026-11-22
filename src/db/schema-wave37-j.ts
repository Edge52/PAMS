/**
 * Wave 37 (agent J): tender timetable and the clarifications and addenda register (Law 182/2018 art. 7, 19, 39).
 * Re-exported from ./schema at its very end. Columns on `projects` (procurement method, justification, approving
 * authority) live in schema.ts beside the table. Pure rules: src/lib/procurement/timetable.ts and clarifications.ts.
 */
import { boolean, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { projects, rfqs, suppliers } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/**
 * One step of a project's tender timetable: planned and (when entered by hand) actual dates. Steps the app already
 * knows (technical opening, RFQ closing, award approval…) take their actual date from those records instead.
 * `step` is one of TIMETABLE_STEPS in src/lib/procurement/timetable.ts.
 */
export const tenderTimetableSteps = pgTable("tender_timetable_steps", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  step: varchar("step", { length: 32 }).notNull(),
  plannedDate: date("planned_date"),
  actualDate: date("actual_date"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("tender_timetable_steps_uq").on(t.projectId, t.step)]);

/** A bidder's question on an RFQ and the answer sent to every invited supplier (without saying who asked). */
export const tenderClarifications = pgTable("tender_clarifications", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  receivedOn: date("received_on").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  /** The day the answer went to all bidders; null = not sent yet. */
  sentOn: date("sent_on"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("tender_clarifications_rfq_idx").on(t.rfqId)]);

/** Numbered addenda to an RFQ (Addendum 1, 2…). An extension moves the RFQ closing date (old and new kept here). */
export const tenderAddenda = pgTable("tender_addenda", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  issuedOn: date("issued_on").notNull(),
  summary: text("summary").notNull(),
  extendsDeadline: boolean("extends_deadline").notNull().default(false),
  previousClosingDate: date("previous_closing_date"),
  newClosingDate: date("new_closing_date"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("tender_addenda_uq").on(t.rfqId, t.number)]);

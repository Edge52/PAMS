/**
 * Wave 41 (agent J): notification choices per person, the daily digest, approval deputies (out of office),
 * approval and fault-report escalation, and the biomedical on-call list. Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => users.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated. Rules: src/lib/notifications/prefs.ts, src/lib/approvals/escalation.ts, src/lib/assets/fault-escalation.ts.
 */
import { boolean, check, date, index, integer, pgTable, primaryKey, serial, smallint, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { approvalSteps, facilities, users, workOrders } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** One person's choice for one notification kind: APP, EMAIL, BOTH or OFF. No row = the role default. */
export const notificationPrefs = pgTable("notification_prefs", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 48 }).notNull(),
  channel: varchar("channel", { length: 8 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind] })]);

/** Daily digest instead of each email: on/off, the hour (Cairo time, 0–23) and the last day it went out. */
export const notificationDigests = pgTable("notification_digests", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  hour: smallint("hour").notNull().default(7),
  lastSentOn: date("last_sent_on"),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
}, (t) => [check("notification_digests_hour_check", sql`${t.hour} between 0 and 23`)]);

/** Out of office: approvals for `userId` go to `deputyId` from startsOn to endsOn (both days included). */
export const approvalDelegations = pgTable("approval_delegations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deputyId: integer("deputy_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  reason: text("reason"),
  setById: integer("set_by_id").references(() => users.id, { onDelete: "set null" }),
  setByName: text("set_by_name"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("approval_delegations_user_idx").on(t.userId, t.endsOn),
  index("approval_delegations_deputy_idx").on(t.deputyId, t.endsOn),
  check("approval_delegations_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
  check("approval_delegations_self_check", sql`${t.deputyId} <> ${t.userId}`),
]);

/**
 * When an approval step became pending, its reminders and escalation, and — when a deputy decided it — whom they
 * decided for. One row per step; a pending step without a row counts from the request's submission.
 */
export const approvalStepTracking = pgTable("approval_step_tracking", {
  stepId: integer("step_id").primaryKey().references(() => approvalSteps.id, { onDelete: "cascade" }),
  pendingSince: timestamp("pending_since", { withTimezone: true }).notNull().defaultNow(),
  /** 1 = approver reminded, 2 = escalated to the director (or administrator). */
  level: smallint("level").notNull().default(0),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  decidedForId: integer("decided_for_id").references(() => users.id, { onDelete: "set null" }),
  decidedForName: text("decided_for_name"),
});

/** Fault reports not acknowledged in time: 1 = on-duty team told again, 2 = biomedical lead told. */
export const workOrderEscalations = pgTable("work_order_escalations", {
  workOrderId: integer("work_order_id").primaryKey().references(() => workOrders.id, { onDelete: "cascade" }),
  level: smallint("level").notNull().default(0),
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who is on duty for biomedical faults in a hospital and when. No current entry = every technician and engineer. */
export const biomedOnCall = pgTable("biomed_on_call", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  setByName: text("set_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("biomed_on_call_facility_idx").on(t.facilityId, t.endsAt),
  check("biomed_on_call_times_check", sql`${t.endsAt} > ${t.startsAt}`),
]);

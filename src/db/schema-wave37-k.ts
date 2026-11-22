/**
 * Wave 37 (agent K): calibration of clinical devices, and imaging radiation safety records (ENRRA licences,
 * physicist QC tests, staff dosimetry, protective equipment checks). Re-exported from ./schema.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated, so its tables and enums can't be used at the top level here. Asset statuses are kept as text for that
 * reason (calibrations.status_before).
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgEnum, pgTable, real, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { assets, departments, deviceTypes, facilities, rooms, suppliers, users } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ───────────────────── Calibration of clinical devices ───────────────────── */

/** PASS = in tolerance as found; ADJUSTED = out of tolerance, adjusted and now in tolerance; FAIL = can't be brought in. */
export const calibrationResult = pgEnum("calibration_result", ["PASS", "ADJUSTED", "FAIL"]);

/** The calibration interval of a device type (default for its devices). No row = 12 months. */
export const deviceTypeCalibration = pgTable("device_type_calibration", {
  deviceTypeId: integer("device_type_id").primaryKey().references(() => deviceTypes.id, { onDelete: "cascade" }),
  intervalMonths: integer("interval_months").notNull(),
  updatedAt: updatedAt(),
}, (t) => [check("device_type_calibration_interval_check", sql`${t.intervalMonths} between 1 and 120`)]);

/** A device's own calibration interval, overriding its type's (for example the maker asks for six-monthly). */
export const assetCalibration = pgTable("asset_calibration", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id, { onDelete: "restrict" }),
  intervalMonths: integer("interval_months").notNull(),
  reason: text("reason"),
  updatedAt: updatedAt(),
}, (t) => [check("asset_calibration_interval_check", sql`${t.intervalMonths} between 1 and 120`)]);

/** One calibration of a clinical device. The certificate is a document of entity type "calibration". */
export const calibrations = pgTable("calibrations", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  calibratedOn: date("calibrated_on").notNull(),
  /** Who did it: the engineer's name, or the lab's. */
  performedBy: text("performed_by").notNull(),
  vendorId: integer("vendor_id").references(() => suppliers.id, { onDelete: "set null" }),
  certificateRef: text("certificate_ref"),
  result: calibrationResult("result").notNull(),
  /** The interval used to work out the next due date (null when it failed: no next date until it passes). */
  intervalMonths: integer("interval_months"),
  nextDue: date("next_due"),
  notes: text("notes"),
  /** A failed calibration took the device out of service: the status it had before, to put back on a pass. */
  statusBefore: varchar("status_before", { length: 24 }),
  maintenanceEventId: integer("maintenance_event_id"),
  recordedById: integer("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("calibrations_asset_idx").on(t.assetId, t.calibratedOn),
  index("calibrations_facility_idx").on(t.facilityId),
  check("calibrations_interval_check", sql`${t.intervalMonths} is null or ${t.intervalMonths} between 1 and 120`),
  check("calibrations_next_due_check", sql`${t.nextDue} is null or ${t.nextDue} > ${t.calibratedOn}`),
]);

/* ───────────────────── Radiation safety (X-ray, CT, C-arm…) ───────────────────── */

export const radiationResult = pgEnum("radiation_result", ["PASS", "FAIL"]);

/** An ENRRA (Egyptian Nuclear and Radiological Regulatory Authority) licence for a room or a device. Document entity "radiation_licence". */
export const radiationLicences = pgTable("radiation_licences", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  assetId: integer("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  licenceNumber: text("licence_number").notNull(),
  /** What it allows, in the authority's words (e.g. "Diagnostic radiology, one fixed X-ray unit"). */
  scope: text("scope"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on").notNull(),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("radiation_licences_facility_idx").on(t.facilityId, t.expiresOn),
  index("radiation_licences_room_idx").on(t.roomId), index("radiation_licences_asset_idx").on(t.assetId),
  check("radiation_licences_dates_check", sql`${t.issuedOn} is null or ${t.issuedOn} <= ${t.expiresOn}`),
]);

/** A periodic quality control test by the medical physicist (on a device, or a room's shielding). */
export const radiationQcTests = pgTable("radiation_qc_tests", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  assetId: integer("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  testName: text("test_name").notNull(),
  testedOn: date("tested_on").notNull(),
  physicist: text("physicist").notNull(),
  result: radiationResult("result").notNull(),
  nextDue: date("next_due"),
  notes: text("notes"),
  recordedByName: text("recorded_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("radiation_qc_facility_idx").on(t.facilityId, t.testedOn),
  index("radiation_qc_asset_idx").on(t.assetId), index("radiation_qc_room_idx").on(t.roomId),
  check("radiation_qc_next_due_check", sql`${t.nextDue} is null or ${t.nextDue} > ${t.testedOn}`),
]);

/** One dosimetry badge reading for one person and period. Kept minimal: a name and a role, no national ID. */
export const dosimetryPeriods = pgTable("dosimetry_periods", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  personName: text("person_name").notNull(),
  personRole: text("person_role"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  /** Effective dose for the period, mSv. */
  doseMsv: real("dose_msv").notNull(),
  /** The limit the reading was judged against for this period, mSv (pro rata of the annual limit). */
  limitMsv: real("limit_msv").notNull(),
  /** At or over the investigation level (a share of the limit) or over the limit: see src/lib/assets/radiation.ts. */
  flag: varchar("flag", { length: 12 }).notNull().default("OK"),
  notes: text("notes"),
  recordedByName: text("recorded_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("dosimetry_facility_idx").on(t.facilityId, t.periodEnd),
  check("dosimetry_dates_check", sql`${t.periodStart} <= ${t.periodEnd}`),
  check("dosimetry_dose_check", sql`${t.doseMsv} >= 0 and ${t.limitMsv} > 0`),
]);

/** Lead aprons, thyroid collars, shields and other protective equipment, checked at intervals. */
export const protectiveItems = pgTable("protective_items", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  /** APRON, THYROID, GLOVES, GLASSES, SHIELD, OTHER (src/lib/assets/radiation.ts). */
  kind: varchar("kind", { length: 16 }).notNull(),
  label: text("label").notNull(),
  intervalMonths: integer("interval_months").notNull().default(12),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("protective_items_facility_idx").on(t.facilityId), index("protective_items_room_idx").on(t.roomId),
  check("protective_items_interval_check", sql`${t.intervalMonths} between 1 and 60`),
]);

export const protectiveChecks = pgTable("protective_checks", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => protectiveItems.id, { onDelete: "cascade" }),
  checkedOn: date("checked_on").notNull(),
  /** "Visual and feel", "X-ray screened"… */
  method: text("method"),
  result: radiationResult("result").notNull(),
  checkedBy: text("checked_by").notNull(),
  nextDue: date("next_due"),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [index("protective_checks_item_idx").on(t.itemId, t.checkedOn)]);

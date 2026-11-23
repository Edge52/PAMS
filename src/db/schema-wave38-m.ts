/**
 * Wave 38 (agent M): contract covered hours and public holidays, MRI helium (cryogen) logs, daily exam counts imported
 * from the RIS/PACS with AE titles, and X-ray/CT tube life. Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated. Side tables only; no new columns on assets, device_types or work_orders.
 */
import { sql } from "drizzle-orm";
import {
  boolean, check, date, doublePrecision, index, integer, numeric, pgTable, primaryKey, real, serial, smallint, text, timestamp, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import { assets, facilities, serviceContracts, users } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ───────────────────── Contract covered hours (audit #12) ───────────────────── */

/**
 * The hours a service contract's uptime guarantee covers. No row = round the clock (as before). Days are 0 = Sunday …
 * 6 = Saturday; times are Cairo wall-clock "HH:MM" ("24:00" allowed as the end). An end before the start is an
 * overnight shift that ends the next day. Rules in src/lib/assets/coverage.ts.
 */
export const contractCoverage = pgTable("contract_coverage", {
  contractId: integer("contract_id").primaryKey().references(() => serviceContracts.id, { onDelete: "cascade" }),
  allHours: boolean("all_hours").notNull().default(false),
  days: smallint("days").array().notNull().default(sql`'{0,1,2,3,4}'::smallint[]`),
  fromTime: varchar("from_time", { length: 5 }).notNull().default("08:00"),
  toTime: varchar("to_time", { length: 5 }).notNull().default("20:00"),
  excludeHolidays: boolean("exclude_holidays").notNull().default(true),
  updatedAt: updatedAt(),
}, (t) => [
  check("contract_coverage_from_check", sql`${t.fromTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  check("contract_coverage_to_check", sql`${t.toTime} ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'`),
]);

/** A hospital's public holidays (editable). Religious holidays move with the moon: `approximate` until confirmed. */
export const publicHolidays = pgTable("public_holidays", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  name: text("name").notNull(),
  approximate: boolean("approximate").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("public_holidays_facility_day_uq").on(t.facilityId, t.day)]);

/* ───────────────────── MRI helium and cryogen log (audit #14) ───────────────────── */

/**
 * Settings of one MRI magnet. No row = the defaults in src/lib/assets/cryogen.ts. `cryogenic` false for a
 * permanent or resistive magnet (many open MRIs), which has no helium to log.
 */
export const mriMagnets = pgTable("mri_magnets", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id, { onDelete: "restrict" }),
  cryogenic: boolean("cryogenic").notNull().default(true),
  heliumMinPct: real("helium_min_pct").notNull().default(70),
  maxDropPct: real("max_drop_pct").notNull().default(2),
  dropWindowDays: integer("drop_window_days").notNull().default(30),
  maxGapDays: integer("max_gap_days").notNull().default(7),
  notes: text("notes"),
  updatedAt: updatedAt(),
}, (t) => [
  check("mri_magnets_min_check", sql`${t.heliumMinPct} between 0 and 100`),
  check("mri_magnets_drop_check", sql`${t.maxDropPct} > 0 and ${t.maxDropPct} <= 100`),
  check("mri_magnets_window_check", sql`${t.dropWindowDays} between 1 and 365`),
  check("mri_magnets_gap_check", sql`${t.maxGapDays} between 1 and 90`),
]);

/** One cryogen reading of an MRI magnet, as on the daily or weekly check sheet. */
export const cryogenReadings = pgTable("cryogen_readings", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  readOn: date("read_on").notNull(),
  heliumPct: real("helium_pct").notNull(),
  pressurePsi: real("pressure_psi"),
  /** RUNNING / STOPPED (cold head); RUNNING / STOPPED / FAULT (compressor). Null = not checked. */
  coldHead: varchar("cold_head", { length: 12 }),
  compressor: varchar("compressor", { length: 12 }),
  chillerTempC: real("chiller_temp_c"),
  remarks: text("remarks"),
  readBy: text("read_by").notNull(),
  recordedById: integer("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("cryogen_readings_asset_idx").on(t.assetId, t.readOn),
  index("cryogen_readings_facility_idx").on(t.facilityId),
  check("cryogen_readings_helium_check", sql`${t.heliumPct} between 0 and 100`),
  check("cryogen_readings_pressure_check", sql`${t.pressurePsi} is null or ${t.pressurePsi} between -15 and 100`),
  check("cryogen_readings_chiller_check", sql`${t.chillerTempC} is null or ${t.chillerTempC} between -20 and 60`),
]);

/* ───────────────────── Exam counts from the RIS / PACS (audit #15) ───────────────────── */

/** DICOM AE titles of a device (as they appear in RIS/PACS exports). One title belongs to one device. */
export const assetAeTitles = pgTable("asset_ae_titles", {
  aeTitle: varchar("ae_title", { length: 16 }).primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [index("asset_ae_titles_asset_idx").on(t.assetId), check("asset_ae_titles_upper_check", sql`${t.aeTitle} = upper(${t.aeTitle})`)]);

/**
 * Exams one device did on one day, per procedure ("" = not given), imported from a file. Re-importing a device's day
 * replaces all its rows for that day. Month totals are copied into imaging_usage (source of the existing figures).
 */
export const examCounts = pgTable("exam_counts", {
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  day: date("day").notNull(),
  procedure: text("procedure").notNull().default(""),
  modality: varchar("modality", { length: 16 }),
  exams: integer("exams").notNull(),
  source: text("source"),
  importedByName: text("imported_by_name"),
  importedAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.assetId, t.day, t.procedure] }),
  check("exam_counts_exams_check", sql`${t.exams} between 0 and 10000`),
]);

/* ───────────────────── X-ray and CT tube life (audit #17) ───────────────────── */

/**
 * One X-ray tube fitted to a device. The tube in use has no `removedOn`; a replacement closes it and adds the new
 * one, so the rows of a device are its replacement history. Counter unit: src/lib/assets/tubes.ts (TUBE_COUNTERS).
 */
export const xrayTubes = pgTable("xray_tubes", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  serialNumber: text("serial_number").notNull(),
  maker: text("maker"),
  model: text("model"),
  counterUnit: varchar("counter_unit", { length: 16 }).notNull(),
  installedOn: date("installed_on").notNull(),
  /** The device's tube counter when this tube was fitted (0 for a counter that resets with the tube). */
  counterAtInstall: doublePrecision("counter_at_install").notNull().default(0),
  warrantyMonths: integer("warranty_months"),
  /** Warranty in counter units used on this tube (e.g. 200,000 scan seconds). Whichever of the two comes first. */
  warrantyCounter: doublePrecision("warranty_counter"),
  /** Expected life in counter units used on this tube; null = forecast by warranty only. */
  expectedLife: doublePrecision("expected_life"),
  cost: numeric("cost", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 3 }),
  /** Fitted free under the previous tube's warranty. */
  underWarranty: boolean("under_warranty").notNull().default(false),
  removedOn: date("removed_on"),
  removedReason: text("removed_reason"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("xray_tubes_asset_idx").on(t.assetId, t.installedOn),
  index("xray_tubes_facility_idx").on(t.facilityId),
  uniqueIndex("xray_tubes_one_in_use_uq").on(t.assetId).where(sql`${t.removedOn} is null`),
  check("xray_tubes_dates_check", sql`${t.removedOn} is null or ${t.removedOn} >= ${t.installedOn}`),
  check("xray_tubes_counter_check", sql`${t.counterAtInstall} >= 0`),
  check("xray_tubes_warranty_check", sql`(${t.warrantyMonths} is null or ${t.warrantyMonths} between 1 and 240) and (${t.warrantyCounter} is null or ${t.warrantyCounter} > 0)`),
  check("xray_tubes_life_check", sql`${t.expectedLife} is null or ${t.expectedLife} > 0`),
  check("xray_tubes_cost_check", sql`${t.cost} is null or ${t.cost} >= 0`),
]);

/** A tube counter reading from the service menu (the device's counter, in the tube's unit). */
export const tubeReadings = pgTable("tube_readings", {
  id: serial("id").primaryKey(),
  tubeId: integer("tube_id").notNull().references(() => xrayTubes.id, { onDelete: "cascade" }),
  readOn: date("read_on").notNull(),
  counter: doublePrecision("counter").notNull(),
  note: text("note"),
  readByName: text("read_by_name"),
  createdAt: createdAt(),
}, (t) => [index("tube_readings_tube_idx").on(t.tubeId, t.readOn), check("tube_readings_counter_check", sql`${t.counter} >= 0`)]);

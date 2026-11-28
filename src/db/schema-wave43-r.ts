/**
 * Wave 43 (agent R): patient dose and diagnostic reference levels (GAHAR DAS.09 patient dose; ICRP 135 DRLs).
 * Re-exported from ./schema at its very end. No patient names or identifiers are stored: a dose record has the
 * exam's date, scanner, exam type, protocol, age group and dose values only.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated. Rules: src/lib/assets/patient-dose.ts.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { assets, facilities, users } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/**
 * A hospital's DRL for one exam type, age group and dose quantity, with the source and year the hospital entered
 * (national survey, local survey, or an example row to replace: `isExample`).
 */
export const doseReferenceLevels = pgTable("dose_reference_levels", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  /** CT, XRAY, FLUORO, MAMMO (lib/assets/patient-dose DOSE_MODALITIES). */
  modality: varchar("modality", { length: 8 }).notNull(),
  examType: text("exam_type").notNull(),
  /** ADULT, CHILD_0, CHILD_1, CHILD_5, CHILD_10. */
  ageGroup: varchar("age_group", { length: 10 }).notNull().default("ADULT"),
  /** ctdivol, dlp, dap, esd, time, agd (units in QUANTITY_UNITS). */
  quantity: varchar("quantity", { length: 8 }).notNull(),
  value: doublePrecision("value").notNull(),
  source: text("source").notNull(),
  sourceYear: integer("source_year"),
  isExample: boolean("is_example").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("dose_reference_levels_uq").on(t.facilityId, t.modality, sql`lower(${t.examType})`, t.ageGroup, t.quantity),
  check("dose_reference_levels_value_check", sql`${t.value} > 0`),
  check("dose_reference_levels_year_check", sql`${t.sourceYear} is null or ${t.sourceYear} between 1990 and 2100`),
]);

/** One exam's dose, entered by hand or imported from the RIS / dose system export. */
export const doseRecords = pgTable("dose_records", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  examDate: date("exam_date").notNull(),
  modality: varchar("modality", { length: 8 }).notNull(),
  examType: text("exam_type").notNull(),
  protocol: text("protocol"),
  ageGroup: varchar("age_group", { length: 10 }).notNull().default("ADULT"),
  ctdivol: doublePrecision("ctdivol"),
  dlp: doublePrecision("dlp"),
  dap: doublePrecision("dap"),
  esd: doublePrecision("esd"),
  /** Fluoroscopy screening time in minutes. */
  fluoroTime: doublePrecision("fluoro_time"),
  agd: doublePrecision("agd"),
  /** ENTERED or IMPORT; `importFile` names the file. */
  source: varchar("source", { length: 8 }).notNull().default("ENTERED"),
  importFile: text("import_file"),
  enteredById: integer("entered_by_id").references(() => users.id, { onDelete: "set null" }),
  enteredByName: text("entered_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("dose_records_asset_idx").on(t.assetId, t.examDate),
  index("dose_records_facility_idx").on(t.facilityId, t.examDate),
  check("dose_records_values_check", sql`coalesce(${t.ctdivol}, 0) >= 0 and coalesce(${t.dlp}, 0) >= 0 and coalesce(${t.dap}, 0) >= 0 and coalesce(${t.esd}, 0) >= 0 and coalesce(${t.fluoroTime}, 0) >= 0 and coalesce(${t.agd}, 0) >= 0`),
]);

/**
 * The medical physicist's review of a month whose median was above the DRL (one per scanner, exam type, age group
 * and month): what was found and the action taken.
 */
export const doseReviews = pgTable("dose_reviews", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  modality: varchar("modality", { length: 8 }).notNull(),
  /** examKey() of the exam type. */
  examKey: text("exam_key").notNull(),
  examType: text("exam_type").notNull(),
  ageGroup: varchar("age_group", { length: 10 }).notNull(),
  /** YYYY-MM. */
  month: varchar("month", { length: 7 }).notNull(),
  /** The medians and DRLs when reviewed, e.g. "CTDIvol 71 mGy (DRL 60)". */
  figures: text("figures"),
  findings: text("findings").notNull(),
  action: text("action").notNull(),
  reviewedOn: date("reviewed_on").notNull(),
  reviewedById: integer("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedByName: text("reviewed_by_name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("dose_reviews_uq").on(t.assetId, t.modality, t.examKey, t.ageGroup, t.month),
  index("dose_reviews_facility_idx").on(t.facilityId, t.month),
]);

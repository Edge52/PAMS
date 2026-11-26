/**
 * Wave 40 (agent I): GAHAR readiness — technician competency (EFS.10), routine imaging QC by technologists (DAS.05),
 * EDA vigilance (GL.CAP.Care.040: safety contact officer, devices kept as found, the maker's and EDA's report
 * references), recall acknowledgements and openFDA imports, IEC 62353 insulation paths and test waivers, and
 * dosimetry extras (eye lens, extremity, declared pregnancy). Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated. Rules: src/lib/assets/competency.ts, imaging-qc.ts, vigilance.ts, openfda.ts, safety-tests.ts, dosimetry.ts.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { assets, departments, deviceTypes, dosimetryPeriods, facilities, incidents, recalls, safetyTests, users, workOrders } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ───────────────────── Technician competency (GAHAR EFS.10 EOC 2–3) ───────────────────── */

/**
 * One person's training on a device type or a category (a level 1–2 device type covers every type under it).
 * kind: MAKER (manufacturer's course), IN_HOUSE, ON_THE_JOB. The certificate is a document of entity type "competency".
 */
export const competencies = pgTable("competencies", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 16 }).notNull(),
  trainedOn: date("trained_on").notNull(),
  /** Null = does not expire. */
  expiresOn: date("expires_on"),
  /** May service this type on their own (the biomedical lead's sign-off). */
  authorised: boolean("authorised").notNull().default(false),
  trainer: text("trainer"),
  certificateRef: text("certificate_ref"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  recordedById: integer("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("competencies_user_idx").on(t.userId), index("competencies_type_idx").on(t.deviceTypeId),
  check("competencies_dates_check", sql`${t.expiresOn} is null or ${t.expiresOn} >= ${t.trainedOn}`),
]);

/** A job given to someone not authorised for the device's type: allowed (warn, not block), and kept here. */
export const competencyOverrides = pgTable("competency_overrides", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: text("user_name").notNull(),
  /** What the check found: "none" (no record), "expired", "not_authorised". */
  problem: varchar("problem", { length: 16 }).notNull(),
  reason: text("reason"),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("competency_overrides_facility_idx").on(t.facilityId, t.at), index("competency_overrides_wo_idx").on(t.workOrderId)]);

/* ───────────────────── Routine imaging QC by technologists (GAHAR DAS.05) ───────────────────── */

/** One QC item: pass/fail, or a measured value with limits. Shape checked by cleanItems in lib/assets/imaging-qc. */
export type QcItem = { label: string; kind: "PASS_FAIL" | "VALUE"; unit?: string | null; min?: number | null; max?: number | null };
export type QcAnswer = { label: string; result: "PASS" | "FAIL" | "NA"; value?: number | null; note?: string | null };

/** A hospital's QC template for a modality and a frequency. Example templates are marked so they are adapted first. */
export const imagingQcTemplates = pgTable("imaging_qc_templates", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  /** CT, MRI, XRAY, MAMMO, FLUORO, US (lib/assets/imaging-qc MODALITIES). */
  modality: varchar("modality", { length: 12 }).notNull(),
  name: text("name").notNull(),
  /** DAILY, WEEKLY, MONTHLY. */
  frequency: varchar("frequency", { length: 8 }).notNull(),
  items: jsonb("items").$type<QcItem[]>().notNull(),
  isExample: boolean("is_example").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("imaging_qc_templates_facility_idx").on(t.facilityId, t.modality)]);

/** One QC run on one scanner with a template; results copy the items' labels and limits as they were. */
export const imagingQcRecords = pgTable("imaging_qc_records", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => imagingQcTemplates.id, { onDelete: "restrict" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  performedOn: date("performed_on").notNull(),
  items: jsonb("items").$type<QcItem[]>().notNull(),
  answers: jsonb("answers").$type<QcAnswer[]>().notNull(),
  passed: boolean("passed").notNull(),
  failedCount: integer("failed_count").notNull().default(0),
  notes: text("notes"),
  /** The work order a failed run opened (one click from the record). */
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  performedById: integer("performed_by_id").references(() => users.id, { onDelete: "set null" }),
  performedByName: text("performed_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("imaging_qc_records_asset_idx").on(t.assetId, t.performedOn), index("imaging_qc_records_facility_idx").on(t.facilityId, t.performedOn),
  index("imaging_qc_records_template_idx").on(t.templateId),
]);

/** The monthly review of a department's QC by the responsible radiologist or physicist. */
export const imagingQcReviews = pgTable("imaging_qc_reviews", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  /** YYYY-MM */
  month: varchar("month", { length: 7 }).notNull(),
  /** RADIOLOGIST, PHYSICIST, OTHER. */
  reviewerRole: varchar("reviewer_role", { length: 16 }).notNull(),
  comments: text("comments"),
  /** Counts at sign-off, so the record keeps what was reviewed. */
  runs: integer("runs").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  missed: integer("missed").notNull().default(0),
  signedById: integer("signed_by_id").references(() => users.id, { onDelete: "set null" }),
  signedByName: text("signed_by_name").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("imaging_qc_reviews_dept_month_idx").on(t.departmentId, t.month), check("imaging_qc_reviews_month_check", sql`${t.month} ~ '^[0-9]{4}-[0-9]{2}$'`)]);

/* ───────────────────── EDA vigilance (GL.CAP.Care.040 v1) ───────────────────── */

/** Per hospital: the medical-device safety contact officer (named to the EDA) and the radiation protection officer. */
export const facilitySafetyContacts = pgTable("facility_safety_contacts", {
  facilityId: integer("facility_id").primaryKey().references(() => facilities.id, { onDelete: "cascade" }),
  officerUserId: integer("officer_user_id").references(() => users.id, { onDelete: "set null" }),
  officerName: text("officer_name"),
  officerJobTitle: text("officer_job_title"),
  officerPhone: text("officer_phone"),
  officerEmail: text("officer_email"),
  /** Radiation protection officer: the only one (with administrators) who sees declared pregnancies. */
  rpoUserId: integer("rpo_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedByName: text("updated_by_name"),
  updatedAt: updatedAt(),
});

/**
 * A device kept as found (quarantined) after an incident: no repair work and no disposal until it is released.
 * Open while released_at is null; at most one open hold per device.
 */
export const assetQuarantines = pgTable("asset_quarantines", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  /** Where the device is kept meanwhile (EDA Annex 2 asks for it). */
  keptAt: text("kept_at"),
  placedById: integer("placed_by_id").references(() => users.id, { onDelete: "set null" }),
  placedByName: text("placed_by_name"),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  releasedById: integer("released_by_id").references(() => users.id, { onDelete: "set null" }),
  releasedByName: text("released_by_name"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releaseReason: text("release_reason"),
}, (t) => [
  uniqueIndex("asset_quarantines_open_idx").on(t.assetId).where(sql`${t.releasedAt} is null`),
  index("asset_quarantines_facility_idx").on(t.facilityId),
]);

/** EDA Annex 2 fields an incident lacks: the maker's report reference, lot, UDI, where the device is kept, contact. */
export const incidentVigilance = pgTable("incident_vigilance", {
  incidentId: integer("incident_id").primaryKey().references(() => incidents.id, { onDelete: "cascade" }),
  makerReference: text("maker_reference"),
  lotNumber: text("lot_number"),
  udi: text("udi"),
  keptAt: text("kept_at"),
  reporterJobTitle: text("reporter_job_title"),
  reporterPhone: text("reporter_phone"),
  reporterEmail: text("reporter_email"),
  updatedByName: text("updated_by_name"),
  updatedAt: updatedAt(),
});

/* ───────────────────── Recalls: acknowledgement and openFDA import ───────────────────── */

/** A department's acknowledgement of a field safety notice (who read it, when). */
export const recallAcknowledgements = pgTable("recall_acknowledgements", {
  id: serial("id").primaryKey(),
  recallId: integer("recall_id").notNull().references(() => recalls.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name").notNull(),
  note: text("note"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("recall_ack_recall_dept_idx").on(t.recallId, t.departmentId)]);

/** An uploaded openFDA recall or enforcement file. Rows that match a device by maker and model wait for a person. */
export const recallImports = pgTable("recall_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  /** "recall" (device/recall) or "enforcement" (device/enforcement). */
  kind: varchar("kind", { length: 16 }).notNull(),
  rowsRead: integer("rows_read").notNull(),
  candidates: integer("candidates").notNull(),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name"),
  createdAt: createdAt(),
});

export type ImportMatch = { assetId: number; tag: string; facilityId: number; score: number; why: string };

export const recallImportRows = pgTable("recall_import_rows", {
  id: serial("id").primaryKey(),
  importId: integer("import_id").notNull().references(() => recallImports.id, { onDelete: "cascade" }),
  /** The FDA's own number (recall number, or res_event_number / product_res_number). */
  fdaNumber: text("fda_number"),
  firm: text("firm"),
  product: text("product"),
  codeInfo: text("code_info"),
  reason: text("reason"),
  classification: text("classification"),
  initiatedOn: date("initiated_on"),
  fdaStatus: text("fda_status"),
  matches: jsonb("matches").$type<ImportMatch[]>().notNull(),
  /** PENDING, CONFIRMED (a recall was recorded), DISMISSED. */
  status: varchar("status", { length: 12 }).notNull().default("PENDING"),
  recallId: integer("recall_id").references(() => recalls.id, { onDelete: "set null" }),
  decidedByName: text("decided_by_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("recall_import_rows_import_idx").on(t.importId, t.status)]);

/* ───────────────────── Electrical safety (IEC 62353) ───────────────────── */

/** Insulation readings by test path (lib/assets/safety-tests INSULATION_PATHS), besides safety_tests.insulation_mohm. */
export const safetyTestInsulation = pgTable("safety_test_insulation", {
  id: serial("id").primaryKey(),
  safetyTestId: integer("safety_test_id").notNull().references(() => safetyTests.id, { onDelete: "cascade" }),
  path: varchar("path", { length: 24 }).notNull(),
  mohm: real("mohm").notNull(),
  limitMohm: real("limit_mohm").notNull(),
}, (t) => [index("safety_test_insulation_test_idx").on(t.safetyTestId), check("safety_test_insulation_check", sql`${t.mohm} >= 0`)]);

/** Going on without a passed safety test at acceptance or after a repair: allowed with a reason, kept here. */
export const safetyTestWaivers = pgTable("safety_test_waivers", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  /** ACCEPTANCE or REPAIR. */
  context: varchar("context", { length: 12 }).notNull(),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("safety_test_waivers_asset_idx").on(t.assetId, t.at)]);

/* ───────────────────── Dosimetry extras ───────────────────── */

/** Eye lens Hp(3) and extremity Hp(0.07) readings of a badge period, mSv. */
export const dosimetryExtra = pgTable("dosimetry_extra", {
  periodId: integer("period_id").primaryKey().references(() => dosimetryPeriods.id, { onDelete: "cascade" }),
  eyeLensMsv: real("eye_lens_msv"),
  extremityMsv: real("extremity_msv"),
}, (t) => [check("dosimetry_extra_check", sql`(${t.eyeLensMsv} is null or ${t.eyeLensMsv} >= 0) and (${t.extremityMsv} is null or ${t.extremityMsv} >= 0)`)]);

/**
 * A badge wearer's declared pregnancy: a flag and a date only, no medical detail. Seen only by the hospital's
 * radiation protection officer and administrators. Keyed by hospital and the name as written on the readings.
 */
export const dosimetryDeclarations = pgTable("dosimetry_declarations", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  /** lib/assets/dosimetry personKey(name). */
  personKey: text("person_key").notNull(),
  personName: text("person_name").notNull(),
  pregnancyDeclared: boolean("pregnancy_declared").notNull().default(false),
  declaredOn: date("declared_on"),
  updatedByName: text("updated_by_name"),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("dosimetry_declarations_person_idx").on(t.facilityId, t.personKey)]);

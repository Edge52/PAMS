/**
 * Hospital Procurement & Asset Management System — unified data model.
 *
 * OWNERSHIP: this file is the shared contract owned by the lead.
 * Module agents must NOT edit it. If a module needs a schema change,
 * describe it in your final report and the lead will apply it.
 *
 * Money: numeric(14,2) stored, returned as string by node-postgres; use helpers in src/lib/money.ts.
 * Currencies: ISO codes ("USD","EUR","EGP"). Conversion via exchange_rates (rate = EGP per 1 unit).
 */
import { relations, sql } from "drizzle-orm";
import {
  pgTable, pgEnum, serial, integer, text, varchar, boolean, numeric, real,
  date, timestamp, jsonb, uniqueIndex, index, pgSequence, doublePrecision, primaryKey, type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

/** One line of a PPM checklist: a yes/no check, or a measurement with an optional pass range. */
export type ChecklistItem = { text: string; unit?: string; min?: number; max?: number };
/** The answer recorded on a work order for one checklist line. */
export type ChecklistResult = ChecklistItem & { result: "PASS" | "FAIL" | "NA" | null; value?: number | null; note?: string | null };

/* ───────────────────────────── Enums ───────────────────────────── */

export const userRole = pgEnum("user_role", [
  "ADMIN", "PROCUREMENT", "BIOMEDICAL", "FINANCE", "DEPARTMENT_HEAD", "VIEWER",
  // added in 2.1
  "PLANNER",      // BOQ planner
  "TECHNICIAN",   // biomedical technician
  "DIRECTOR",     // competent authority: approves awards and high-value POs
]);
export const facilityType = pgEnum("facility_type", [
  "GENERAL_HOSPITAL", "SPECIALIZED_HOSPITAL", "UNIVERSITY_HOSPITAL", "MEDICAL_CENTER", "CLINIC", "DIAGNOSTIC_CENTER",
]);
export const roomType = pgEnum("room_type", [
  "PATIENT_ROOM", "WARD", "ICU_BAY", "OPERATING_ROOM", "PROCEDURE_ROOM", "IMAGING_ROOM",
  "LAB", "PHARMACY", "CONSULTATION", "NURSE_STATION", "STORE", "CORRIDOR", "WAITING", "OFFICE", "TECHNICAL", "OTHER",
]);
export const riskClass = pgEnum("risk_class", ["I", "IIa", "IIb", "III"]);

export const supplierType = pgEnum("supplier_type", ["MANUFACTURER", "DISTRIBUTOR", "AGENT", "SERVICE_PROVIDER"]);
export const projectStatus = pgEnum("project_status", [
  "PLANNING", "SPECIFICATION", "RFQ", "EVALUATION", "AWARDED", "DELIVERY", "CLOSED", "CANCELLED",
]);
export const rfqStatus = pgEnum("rfq_status", ["DRAFT", "ISSUED", "CLOSED", "CANCELLED"]);
export const offerStatus = pgEnum("offer_status", [
  "RECEIVED", "UNDER_REVIEW", "SHORTLISTED", "REJECTED", "AWARDED", "WITHDRAWN",
]);
export const complianceStatus = pgEnum("compliance_status", ["COMPLIES", "PARTIAL", "NOT_COMPLIANT", "NOT_STATED"]);
export const incoterm = pgEnum("incoterm", ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"]);
export const poStatus = pgEnum("po_status", [
  "DRAFT", "ISSUED", "ACKNOWLEDGED", "PARTIALLY_DELIVERED", "DELIVERED", "CLOSED", "CANCELLED",
  // added in 2.1: approval before issue
  "PENDING_APPROVAL", "APPROVED",
]);

export const boqBasis = pgEnum("boq_basis", [
  "PER_BED",          // qty = ratio × department beds
  "PER_ROOM",         // qty = ratio × department rooms (ORs, procedure rooms, consultation rooms...)
  "PER_DEPARTMENT",   // qty = ratio × 1 (per department instance)
  "PER_HOSPITAL_BEDS",// qty = ratio × total hospital beds (e.g. 1 per 100 beds → ratio 0.01) — once per BOQ, not per department
  "FIXED",            // qty = ratio (absolute) — once per BOQ, not per department
]);
export const rounding = pgEnum("rounding", ["CEIL", "ROUND", "FLOOR"]);
export const boqTier = pgEnum("boq_tier", ["ESSENTIAL", "RECOMMENDED", "OPTIONAL"]);
export const ruleConfidence = pgEnum("rule_confidence", ["SOURCED", "INDUSTRY_PRACTICE", "DRAFT"]);
export const boqStatus = pgEnum("boq_status", ["DRAFT", "UNDER_REVIEW", "APPROVED", "SUPERSEDED"]);

export const assetStatus = pgEnum("asset_status", [
  "IN_STOCK", "INSTALLED", "IN_SERVICE", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "DISPOSED",
]);
export const assetCondition = pgEnum("asset_condition", ["NEW", "GOOD", "FAIR", "POOR", "CONDEMNED"]);
export const criticality = pgEnum("criticality", ["LIFE_SUPPORT", "HIGH", "MEDIUM", "LOW"]);
export const maintenanceType = pgEnum("maintenance_type", ["PPM", "CORRECTIVE", "CALIBRATION", "INSPECTION", "SAFETY_TEST"]);
export const maintenanceStatus = pgEnum("maintenance_status", ["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "OVERDUE"]);
// added in wave 3 (work orders)
export const workOrderStatus = pgEnum("work_order_status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED", "CANCELLED"]);
export const workOrderPriority = pgEnum("work_order_priority", ["URGENT", "HIGH", "NORMAL", "LOW"]);
export const workOrderCoverage = pgEnum("work_order_coverage", ["NONE", "WARRANTY", "CONTRACT"]);
export const claimStatus = pgEnum("claim_status", ["NOT_CLAIMED", "SUBMITTED", "ACCEPTED", "REJECTED"]);
export const contractType = pgEnum("contract_type", ["FULL_SERVICE", "PREVENTIVE", "PARTS_ONLY", "LABOUR_ONLY", "WARRANTY_EXTENSION"]);
export const partTxnKind = pgEnum("part_txn_kind", ["RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT"]);
export const recallAction = pgEnum("recall_action", ["INSPECT", "SOFTWARE_UPDATE", "MODIFY", "REPLACE_PART", "REMOVE_FROM_USE", "ADVISORY"]);
export const recallStatus = pgEnum("recall_status", ["OPEN", "CLOSED"]);
export const recallAssetStatus = pgEnum("recall_asset_status", ["PENDING", "ACTIONED", "NOT_AFFECTED"]);
export const disposalReason = pgEnum("disposal_reason", ["BEYOND_REPAIR", "END_OF_LIFE", "OBSOLETE", "UNSAFE", "RECALLED", "LOST_OR_STOLEN", "OTHER"]);
export const disposalMethod = pgEnum("disposal_method", ["SCRAP", "SALE", "DONATION", "RETURN_TO_SUPPLIER", "TRADE_IN", "OTHER"]);
export const disposalStatus = pgEnum("disposal_status", ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]);

/* ───────────────────────────── People ───────────────────────────── */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: userRole("role").notNull().default("VIEWER"),
  active: boolean("active").notNull().default(true),
  /** scrypt hash ("scrypt$N$r$p$salt$hash"); null = can't sign in until a password is set. */
  passwordHash: text("password_hash"),
  jobTitle: text("job_title"),
  phone: varchar("phone", { length: 32 }),
  /** true = sees every facility; false = only those in user_facilities. Admins always see all. */
  allFacilities: boolean("all_facilities").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Signed-in browser sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

/* ─────────────────────── Facility & location ─────────────────────── */

export const facilities = pgTable("facilities", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  type: facilityType("type").notNull().default("GENERAL_HOSPITAL"),
  governorate: text("governorate"),
  city: text("city"),
  address: text("address"),
  totalBeds: integer("total_beds").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const buildings = pgTable("buildings", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("buildings_facility_code_uq").on(t.facilityId, t.code)]);

export const floors = pgTable("floors", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  level: integer("level").notNull(),              // -1 basement, 0 ground, 1 first...
  name: text("name").notNull(),
  /** Floor plan background image URL (e.g. /uploads/plans/xyz.png). Optional — map falls back to room grid. */
  planImageUrl: text("plan_image_url"),
  /** Logical canvas size for room polygons / asset pins (units are arbitrary, e.g. 1000 × 600). */
  planWidth: integer("plan_width").notNull().default(1000),
  planHeight: integer("plan_height").notNull().default(600),
  /** Height of the finished floor above the building's reference level, in metres (3D view). Null → level × 5 m. */
  elevation: real("elevation"),
  /** Plan units per metre. 10 when imported from CAD (1 unit = 100 mm); hand-drawn plans use arbitrary units. */
  unitsPerMetre: real("units_per_metre"),
}, (t) => [uniqueIndex("floors_building_level_uq").on(t.buildingId, t.level)]);

/**
 * Architectural linework for a floor imported from CAD, in the floor's plan units (same frame as room polygons).
 * Segments are flat arrays [x1, y1, x2, y2, x1, y1, …]. Loaded on demand by the 3D view.
 */
export const floorCad = pgTable("floor_cad", {
  floorId: integer("floor_id").primaryKey().references(() => floors.id, { onDelete: "cascade" }),
  sourceFile: text("source_file"),
  walls: jsonb("walls").$type<number[]>().notNull(),
  doors: jsonb("doors").$type<number[]>(),
  glass: jsonb("glass").$type<number[]>(),
  columns: jsonb("columns").$type<number[]>(),
  importedAt: createdAt(),
});

/** Department types are the BOQ planning vocabulary (ICU, OR, ER, RAD...). */
export const departmentTypes = pgTable("department_types", {
  code: varchar("code", { length: 32 }).primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  category: text("category"),  // CLINICAL / DIAGNOSTIC / SUPPORT / CRITICAL_CARE ...
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** A real department instance inside a facility. */
export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  departmentTypeCode: varchar("department_type_code", { length: 32 }).references(() => departmentTypes.code),
  code: varchar("code", { length: 32 }).notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  beds: integer("beds").notNull().default(0),
  headName: text("head_name"),
  costCenter: varchar("cost_center", { length: 32 }),
}, (t) => [uniqueIndex("departments_facility_code_uq").on(t.facilityId, t.code)]);

export const rooms = pgTable("rooms", {
  id: serial("id").primaryKey(),
  floorId: integer("floor_id").notNull().references(() => floors.id, { onDelete: "cascade" }),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  code: varchar("code", { length: 32 }).notNull(),   // e.g. "B1-2-ICU-05"
  name: text("name").notNull(),
  type: roomType("type").notNull().default("OTHER"),
  beds: integer("beds").notNull().default(0),
  /** Rectangle on the floor plan, in floor plan units. */
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  w: real("w").notNull().default(100),
  h: real("h").notNull().default(80),
  /** Optional polygon [[x,y],...] overriding the rectangle. */
  polygon: jsonb("polygon").$type<[number, number][]>(),
}, (t) => [
  uniqueIndex("rooms_floor_code_uq").on(t.floorId, t.code),
  index("rooms_department_idx").on(t.departmentId),
]);

/* ───────────────────────── Device taxonomy ───────────────────────── */

/** Hierarchical classification. Level 1 = category, 2 = group, 3 = device type (the unit used in BOQ, specs, assets). */
export const deviceTypes = pgTable("device_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 48 }).notNull().unique(),     // e.g. "MON-PAT-HIGH"
  parentId: integer("parent_id").references((): AnyPgColumn => deviceTypes.id),
  level: integer("level").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  description: text("description"),
  umdnsCode: varchar("umdns_code", { length: 16 }),            // optional cross-reference
  gmdnTerm: text("gmdn_term"),                                  // optional cross-reference
  riskClass: riskClass("risk_class"),
  criticality: criticality("criticality"),
  lifeExpectancyYears: integer("life_expectancy_years"),
  ppmIntervalMonths: integer("ppm_interval_months"),
  requiresCalibration: boolean("requires_calibration").notNull().default(false),
  isCapital: boolean("is_capital").notNull().default(true),
  priceMinUsd: money("price_min_usd"),
  priceMaxUsd: money("price_max_usd"),
  /** Key technical parameters a spec sheet for this type should cover, e.g. [{"name":"Slices","unit":""}]. */
  specTemplate: jsonb("spec_template").$type<{ name: string; unit?: string; hint?: string }[]>(),
  /** PPM checklist for this type (wave 3). Null → inherited from the group/category, else the built-in default. */
  ppmChecklist: jsonb("ppm_checklist").$type<ChecklistItem[]>(),
  active: boolean("active").notNull().default(true),
}, (t) => [index("device_types_parent_idx").on(t.parentId)]);

/* ──────────────────────────── Suppliers ──────────────────────────── */

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: supplierType("type").notNull().default("DISTRIBUTOR"),
  country: text("country"),
  brands: text("brands").array(),
  contactName: text("contact_name"),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 64 }),
  address: text("address"),
  taxId: varchar("tax_id", { length: 64 }),
  commercialRegister: varchar("commercial_register", { length: 64 }),
  rating: real("rating"),                    // 0–5
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exchangeRates = pgTable("exchange_rates", {
  id: serial("id").primaryKey(),
  currency: varchar("currency", { length: 3 }).notNull(),
  rateToEgp: numeric("rate_to_egp", { precision: 14, scale: 6 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
}, (t) => [uniqueIndex("fx_currency_date_uq").on(t.currency, t.effectiveDate)]);

/* ────────────────────────── BOQ standards ────────────────────────── */

export const standardSets = pgTable("standard_sets", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 48 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  version: varchar("version", { length: 16 }).notNull().default("1.0"),
  sources: jsonb("sources").$type<{ id: string; title: string; url?: string; publisher?: string; year?: number }[]>(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const boqRules = pgTable("boq_rules", {
  id: serial("id").primaryKey(),
  standardSetId: integer("standard_set_id").notNull().references(() => standardSets.id, { onDelete: "cascade" }),
  departmentTypeCode: varchar("department_type_code", { length: 32 }).notNull().references(() => departmentTypes.code),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  basis: boqBasis("basis").notNull(),
  ratio: doublePrecision("ratio").notNull(),  // double: float4 made 1/30 × 300 round up to 11
  minQty: integer("min_qty").notNull().default(0),
  maxQty: integer("max_qty"),
  rounding: rounding("rounding").notNull().default("CEIL"),
  tier: boqTier("tier").notNull().default("ESSENTIAL"),
  confidence: ruleConfidence("confidence").notNull().default("DRAFT"),
  sourceRef: varchar("source_ref", { length: 64 }),   // id within standardSets.sources
  notes: text("notes"),
}, (t) => [uniqueIndex("boq_rules_uq").on(t.standardSetId, t.departmentTypeCode, t.deviceTypeId)]);

/* ───────────────────────── Procurement projects ───────────────────────── */

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 48 }).notNull().unique(),     // e.g. tender number
  title: text("title").notNull(),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "set null" }),
  client: text("client"),                                       // e.g. UPA, UHI, private
  status: projectStatus("status").notNull().default("PLANNING"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  budget: money("budget"),
  submissionDeadline: date("submission_deadline"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const boqs = pgTable("boqs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "set null" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  standardSetId: integer("standard_set_id").notNull().references(() => standardSets.id),
  status: boqStatus("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  totalHospitalBeds: integer("total_hospital_beds").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  contingencyPct: real("contingency_pct").notNull().default(0),
  includeTiers: boqTier("include_tiers").array().notNull().default(sql`ARRAY['ESSENTIAL','RECOMMENDED']::boq_tier[]`),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Planned department scope inside a BOQ (the input the rules are applied to). */
export const boqDepartments = pgTable("boq_departments", {
  id: serial("id").primaryKey(),
  boqId: integer("boq_id").notNull().references(() => boqs.id, { onDelete: "cascade" }),
  departmentTypeCode: varchar("department_type_code", { length: 32 }).notNull().references(() => departmentTypes.code),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  label: text("label").notNull(),          // e.g. "Adult ICU — Floor 3"
  beds: integer("beds").notNull().default(0),
  rooms: integer("rooms").notNull().default(0),
  instances: integer("instances").notNull().default(1),
});

export const boqLines = pgTable("boq_lines", {
  id: serial("id").primaryKey(),
  boqId: integer("boq_id").notNull().references(() => boqs.id, { onDelete: "cascade" }),
  boqDepartmentId: integer("boq_department_id").references(() => boqDepartments.id, { onDelete: "cascade" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  ruleId: integer("rule_id").references(() => boqRules.id, { onDelete: "set null" }),
  tier: boqTier("tier").notNull().default("ESSENTIAL"),
  calculatedQty: integer("calculated_qty").notNull().default(0),
  quantity: integer("quantity").notNull().default(0),          // final qty after manual adjustment
  isOverridden: boolean("is_overridden").notNull().default(false),
  isManual: boolean("is_manual").notNull().default(false),      // added by hand, not from a rule
  unitPriceEstimate: money("unit_price_estimate"),
  calcExplanation: text("calc_explanation"),                    // e.g. "12 beds × 1.0 per bed = 12"
  notes: text("notes"),
}, (t) => [index("boq_lines_boq_idx").on(t.boqId)]);

/* ───────────────────────── Specifications ───────────────────────── */

export const techSpecs = pgTable("tech_specs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const specItems = pgTable("spec_items", {
  id: serial("id").primaryKey(),
  specId: integer("spec_id").notNull().references(() => techSpecs.id, { onDelete: "cascade" }),
  section: text("section"),             // "General", "Gantry", "Software"...
  parameter: text("parameter").notNull(),
  requirement: text("requirement").notNull(),   // "≥ 64 slices", "Yes", "≤ 0.35 s"
  unit: varchar("unit", { length: 32 }),
  mandatory: boolean("mandatory").notNull().default(true),
  weight: real("weight").notNull().default(1),   // for technical scoring
  sortOrder: integer("sort_order").notNull().default(0),
});

/* ─────────────────────────── RFQ & offers ─────────────────────────── */

export const rfqs = pgTable("rfqs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  number: varchar("number", { length: 48 }).notNull().unique(),
  title: text("title").notNull(),
  status: rfqStatus("status").notNull().default("DRAFT"),
  issueDate: date("issue_date"),
  closingDate: date("closing_date"),
  boqId: integer("boq_id").references(() => boqs.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const rfqSuppliers = pgTable("rfq_suppliers", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  invitedAt: date("invited_at"),
  responded: boolean("responded").notNull().default(false),
}, (t) => [uniqueIndex("rfq_suppliers_uq").on(t.rfqId, t.supplierId)]);

/**
 * The items an RFQ asks for, frozen when the RFQ is created. Quantities must not move if the BOQ is regenerated
 * after the RFQ has gone out to suppliers.
 */
export const rfqLines = pgTable("rfq_lines", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  quantity: integer("quantity"),                                  // null when the RFQ comes from specs without a BOQ
  boqLineIds: integer("boq_line_ids").array().notNull().default(sql`'{}'::int[]`),
  departments: text("departments").array().notNull().default(sql`'{}'::text[]`),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
}, (t) => [uniqueIndex("rfq_lines_uq").on(t.rfqId, t.deviceTypeId)]);

export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  rfqId: integer("rfq_id").references(() => rfqs.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  reference: varchar("reference", { length: 64 }).notNull(),    // supplier's quotation number
  offerDate: date("offer_date").notNull(),
  validUntil: date("valid_until"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  incoterm: incoterm("incoterm"),
  deliveryWeeks: integer("delivery_weeks"),
  warrantyMonths: integer("warranty_months"),
  paymentTerms: text("payment_terms"),
  status: offerStatus("status").notNull().default("RECEIVED"),
  technicalScore: real("technical_score"),   // 0–100, computed from compliance
  financialScore: real("financial_score"),   // 0–100
  /** Award trail (2.1): approval date, Law 182 art. 39 complaint window (7 days) and acceptance notice (2 days after). */
  awardApprovedOn: date("award_approved_on"),
  complaintUntil: date("complaint_until"),
  acceptanceDue: date("acceptance_due"),
  acceptedOn: date("accepted_on"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("offers_project_idx").on(t.projectId)]);

export const offerLines = pgTable("offer_lines", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => offers.id, { onDelete: "cascade" }),
  boqLineId: integer("boq_line_id").references(() => boqLines.id, { onDelete: "set null" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  specId: integer("spec_id").references(() => techSpecs.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  countryOfOrigin: text("country_of_origin"),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  discountPct: real("discount_pct").notNull().default(0),
  isOptional: boolean("is_optional").notNull().default(false),
});

export const offerCompliance = pgTable("offer_compliance", {
  id: serial("id").primaryKey(),
  offerLineId: integer("offer_line_id").notNull().references(() => offerLines.id, { onDelete: "cascade" }),
  specItemId: integer("spec_item_id").notNull().references(() => specItems.id, { onDelete: "cascade" }),
  offeredValue: text("offered_value"),
  status: complianceStatus("status").notNull().default("NOT_STATED"),
  remark: text("remark"),
}, (t) => [uniqueIndex("offer_compliance_uq").on(t.offerLineId, t.specItemId)]);

/* ────────────────────────── Purchase orders ────────────────────────── */

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 48 }).notNull().unique(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  offerId: integer("offer_id").references(() => offers.id, { onDelete: "set null" }),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "set null" }),
  status: poStatus("status").notNull().default("DRAFT"),
  issueDate: date("issue_date"),
  expectedDelivery: date("expected_delivery"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  incoterm: incoterm("incoterm"),
  paymentTerms: text("payment_terms"),
  warrantyMonths: integer("warranty_months"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const poLines = pgTable("po_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  offerLineId: integer("offer_line_id").references(() => offerLines.id, { onDelete: "set null" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  description: text("description").notNull(),
  manufacturer: text("manufacturer"),
  model: text("model"),
  quantity: integer("quantity").notNull(),
  unitPrice: money("unit_price").notNull(),
  receivedQty: integer("received_qty").notNull().default(0),
  /** Where these units are destined (used to pre-fill asset location on receipt). */
  destinationDepartmentId: integer("destination_department_id").references(() => departments.id, { onDelete: "set null" }),
});

export const deliveries = pgTable("deliveries", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 64 }).notNull(),   // delivery note / GRN number
  deliveryDate: date("delivery_date").notNull(),
  receivedBy: text("received_by"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const deliveryLines = pgTable("delivery_lines", {
  id: serial("id").primaryKey(),
  deliveryId: integer("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id").notNull().references(() => poLines.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull(),
  serialNumbers: text("serial_numbers").array(),
});

/* ───────────────────────────── Assets ───────────────────────────── */

/** Global running number for asset tags (see src/lib/asset-factory.ts). */
export const assetTagSeq = pgSequence("asset_tag_seq", { startWith: 1, increment: 1 });

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  assetTag: varchar("asset_tag", { length: 48 }).notNull().unique(),   // e.g. "FAC01-MON-000123"
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").references(() => departments.id, { onDelete: "set null" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  /** Pin position inside the room's floor plan, in floor plan units. Null → auto-placed inside room. */
  posX: real("pos_x"),
  posY: real("pos_y"),
  parentAssetId: integer("parent_asset_id").references((): AnyPgColumn => assets.id, { onDelete: "set null" }),
  manufacturer: text("manufacturer"),
  model: text("model"),
  serialNumber: varchar("serial_number", { length: 128 }),
  status: assetStatus("status").notNull().default("IN_STOCK"),
  condition: assetCondition("condition").notNull().default("NEW"),
  criticality: criticality("criticality"),
  supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  poLineId: integer("po_line_id").references(() => poLines.id, { onDelete: "set null" }),
  deliveryLineId: integer("delivery_line_id").references(() => deliveryLines.id, { onDelete: "set null" }),
  purchaseCost: money("purchase_cost"),
  currency: varchar("currency", { length: 3 }),
  purchaseDate: date("purchase_date"),
  installDate: date("install_date"),
  warrantyEnd: date("warranty_end"),
  lifeExpectancyYears: integer("life_expectancy_years"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("assets_room_idx").on(t.roomId),
  index("assets_department_idx").on(t.departmentId),
  index("assets_device_type_idx").on(t.deviceTypeId),
  index("assets_facility_idx").on(t.facilityId),
]);

export const assetMovements = pgTable("asset_movements", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  fromRoomId: integer("from_room_id").references(() => rooms.id, { onDelete: "set null" }),
  toRoomId: integer("to_room_id").references(() => rooms.id, { onDelete: "set null" }),
  fromDepartmentId: integer("from_department_id").references(() => departments.id, { onDelete: "set null" }),
  toDepartmentId: integer("to_department_id").references(() => departments.id, { onDelete: "set null" }),
  movedAt: timestamp("moved_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
  movedBy: text("moved_by"),
});

export const maintenanceEvents = pgTable("maintenance_events", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  type: maintenanceType("type").notNull(),
  status: maintenanceStatus("status").notNull().default("SCHEDULED"),
  scheduledDate: date("scheduled_date"),
  completedDate: date("completed_date"),
  performedBy: text("performed_by"),
  vendorId: integer("vendor_id").references(() => suppliers.id, { onDelete: "set null" }),
  cost: money("cost"),
  currency: varchar("currency", { length: 3 }),
  downtimeHours: real("downtime_hours"),
  findings: text("findings"),
  createdAt: createdAt(),
}, (t) => [index("maintenance_asset_idx").on(t.assetId)]);

/**
 * Work order: a fault report or a job on one asset, from report to sign-off (wave 3).
 * OPEN → ASSIGNED → IN_PROGRESS ⇄ ON_HOLD → COMPLETED → CLOSED, or CANCELLED. Rules live in src/lib/assets/work-orders.ts.
 * Completing one writes a maintenance_events row so the maintenance history and PPM due dates stay in one place.
 */
export const workOrders = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 24 }).notNull().unique(),       // WO-2026-0001
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  type: maintenanceType("type").notNull().default("CORRECTIVE"),
  priority: workOrderPriority("priority").notNull().default("NORMAL"),
  status: workOrderStatus("status").notNull().default("OPEN"),
  title: text("title").notNull(),
  description: text("description"),
  /** The device can't be used while this is open — counts as downtime. */
  deviceDown: boolean("device_down").notNull().default(false),
  reportedById: integer("reported_by_id").references(() => users.id, { onDelete: "set null" }),
  reportedByName: text("reported_by_name"),
  reporterContact: text("reporter_contact"),
  assignedToId: integer("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  /** Response target from the priority (URGENT 4 h … LOW 7 days). */
  dueAt: timestamp("due_at", { withTimezone: true }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  downtimeStart: timestamp("downtime_start", { withTimezone: true }),
  downtimeEnd: timestamp("downtime_end", { withTimezone: true }),
  holdReason: text("hold_reason"),
  resolution: text("resolution"),
  rootCause: text("root_cause"),
  laborHours: real("labor_hours"),
  cost: money("cost"),
  currency: varchar("currency", { length: 3 }),
  maintenanceEventId: integer("maintenance_event_id").references(() => maintenanceEvents.id, { onDelete: "set null" }),
  /** The scheduled PPM visit this job carries out (completing the job completes that visit). */
  plannedEventId: integer("planned_event_id").references(() => maintenanceEvents.id, { onDelete: "set null" }),
  checklist: jsonb("checklist").$type<ChecklistResult[]>(),
  /** Cover when the job was raised: warranty, a service contract, or none. */
  coverage: workOrderCoverage("coverage").notNull().default("NONE"),
  contractId: integer("contract_id").references((): AnyPgColumn => serviceContracts.id, { onDelete: "set null" }),
  claimStatus: claimStatus("claim_status").notNull().default("NOT_CLAIMED"),
  claimReference: text("claim_reference"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("work_orders_planned_event_uq").on(t.plannedEventId),
  index("work_orders_asset_idx").on(t.assetId),
  index("work_orders_status_idx").on(t.status),
  index("work_orders_assignee_idx").on(t.assignedToId),
  index("work_orders_facility_idx").on(t.facilityId),
]);

/** Service contract with a vendor covering a set of assets (wave 3). */
export const serviceContracts = pgTable("service_contracts", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 24 }).notNull().unique(),      // SC-2026-0001
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  title: text("title").notNull(),
  type: contractType("type").notNull().default("FULL_SERVICE"),
  vendorReference: text("vendor_reference"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  value: money("value"),
  currency: varchar("currency", { length: 3 }),
  /** Promised on-site response, hours. */
  responseHours: integer("response_hours"),
  ppmVisitsPerYear: integer("ppm_visits_per_year"),
  includesParts: boolean("includes_parts").notNull().default(false),
  contactName: text("contact_name"),
  contactPhone: varchar("contact_phone", { length: 48 }),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("service_contracts_facility_idx").on(t.facilityId), index("service_contracts_end_idx").on(t.endDate)]);

export const serviceContractAssets = pgTable("service_contract_assets", {
  contractId: integer("contract_id").notNull().references(() => serviceContracts.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.contractId, t.assetId] }), index("service_contract_assets_asset_idx").on(t.assetId)]);

/** Spare part held in a hospital's biomedical store (wave 3). Stock moves only through part_transactions. */
export const spareParts = pgTable("spare_parts", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  partNumber: varchar("part_number", { length: 64 }).notNull(),
  name: text("name").notNull(),
  manufacturer: text("manufacturer"),
  /** Device type the part fits (optional; null = general purpose). */
  deviceTypeId: integer("device_type_id").references(() => deviceTypes.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  unitCost: money("unit_cost"),
  currency: varchar("currency", { length: 3 }),
  stockQty: integer("stock_qty").notNull().default(0),
  minQty: integer("min_qty").notNull().default(0),
  location: text("location"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("spare_parts_facility_number_uq").on(t.facilityId, t.partNumber), index("spare_parts_type_idx").on(t.deviceTypeId)]);

/** Every stock movement. quantity is signed: receipts and returns add, issues subtract, adjustments either way. */
export const partTransactions = pgTable("part_transactions", {
  id: serial("id").primaryKey(),
  partId: integer("part_id").notNull().references(() => spareParts.id, { onDelete: "cascade" }),
  kind: partTxnKind("kind").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: money("unit_cost"),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  note: text("note"),
  actor: text("actor"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("part_txn_part_idx").on(t.partId), index("part_txn_wo_idx").on(t.workOrderId)]);

/** Field safety corrective action / recall notice from a manufacturer or regulator (wave 3). Not tied to one hospital. */
export const recalls = pgTable("recalls", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 24 }).notNull().unique(),          // FSCA-2026-0001
  reference: text("reference"),                                          // manufacturer's FSN reference
  source: text("source"),                                                // e.g. "Manufacturer", "EDA", "FDA"
  title: text("title").notNull(),
  description: text("description"),
  manufacturer: text("manufacturer"),
  deviceTypeId: integer("device_type_id").references(() => deviceTypes.id, { onDelete: "set null" }),
  /** Model text to match (case-insensitive, contained in the asset's model). */
  modelPattern: text("model_pattern"),
  /** Affected serial numbers; empty = every serial of the matching model. */
  serialNumbers: text("serial_numbers").array(),
  action: recallAction("action").notNull().default("INSPECT"),
  urgent: boolean("urgent").notNull().default(false),
  issuedDate: date("issued_date"),
  dueDate: date("due_date"),
  status: recallStatus("status").notNull().default("OPEN"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const recallAssets = pgTable("recall_assets", {
  recallId: integer("recall_id").notNull().references(() => recalls.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  status: recallAssetStatus("status").notNull().default("PENDING"),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  actionedAt: timestamp("actioned_at", { withTimezone: true }),
  note: text("note"),
}, (t) => [primaryKey({ columns: [t.recallId, t.assetId] }), index("recall_assets_asset_idx").on(t.assetId), index("recall_assets_wo_idx").on(t.workOrderId)]);

/**
 * Condemnation and disposal of an asset (wave 3). DRAFT → PENDING_APPROVAL (approvals engine, entity DISPOSAL) →
 * APPROVED (asset condemned, out of service) → COMPLETED (asset DISPOSED); or REJECTED / CANCELLED.
 */
export const disposals = pgTable("disposals", {
  id: serial("id").primaryKey(),
  number: varchar("number", { length: 24 }).notNull().unique(),          // DSP-2026-0001
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  reason: disposalReason("reason").notNull(),
  method: disposalMethod("method").notNull().default("SCRAP"),
  justification: text("justification").notNull(),
  /** Residual value expected (sale, trade-in), in currency. */
  estimatedValue: money("estimated_value"),
  currency: varchar("currency", { length: 3 }),
  status: disposalStatus("status").notNull().default("DRAFT"),
  requestedById: integer("requested_by_id").references(() => users.id, { onDelete: "set null" }),
  requestedByName: text("requested_by_name"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  disposedOn: date("disposed_on"),
  proceeds: money("proceeds"),
  certificateRef: text("certificate_ref"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("disposals_asset_idx").on(t.assetId), index("disposals_facility_idx").on(t.facilityId)]);

/** A named camera view of a hospital's 3D model (wave 3). Private to its author unless shared. */
export const twinViews = pgTable("twin_views", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Encoded view (see src/components/assets/twin/view-state.ts). */
  state: text("state").notNull(),
  shared: boolean("shared").notNull().default(false),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
}, (t) => [index("twin_views_facility_idx").on(t.facilityId)]);

/* ───────────────────── Documents & activity log ───────────────────── */

/** Generic attachment for any entity (offer PDFs, datasheets, PO scans, certificates...). */
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),  // "offer" | "po" | "asset" | "spec" | "supplier" | "project" | "delivery"
  entityId: integer("entity_id").notNull(),
  kind: varchar("kind", { length: 32 }),                          // "quotation" | "datasheet" | "certificate" | "po_scan" | "photo"...
  fileName: text("file_name").notNull(),
  url: text("url").notNull(),
  sizeBytes: integer("size_bytes"),
  uploadedAt: createdAt(),
}, (t) => [index("documents_entity_idx").on(t.entityType, t.entityId)]);

export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: integer("entity_id").notNull(),
  action: varchar("action", { length: 48 }).notNull(),   // "created" | "status_changed" | "moved" | ...
  summary: text("summary").notNull(),
  actor: text("actor"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("activity_entity_idx").on(t.entityType, t.entityId)]);


/* ─────────────────────── Release 2.1: access, approvals, alerts ─────────────────────── */

/** Facilities a user may see when users.all_facilities is false. */
export const userFacilities = pgTable("user_facilities", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.userId, t.facilityId] })]);

/** Gap-free-enough document numbers per prefix and year (RFQ-2026-0007). Never reuses a number. */
export const docSequences = pgTable("doc_sequences", {
  prefix: varchar("prefix", { length: 16 }).notNull(),
  year: integer("year").notNull(),
  last: integer("last").notNull(),
}, (t) => [primaryKey({ columns: [t.prefix, t.year] })]);

/** Key/value settings editable by admins (approval mode, email, Law 182 thresholds…). */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const approvalEntity = pgEnum("approval_entity", ["PO", "BOQ", "AWARD", "DISPOSAL"]);
export const approvalStatus = pgEnum("approval_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const approvalStepStatus = pgEnum("approval_step_status", ["WAITING", "PENDING", "APPROVED", "REJECTED", "SKIPPED"]);

/**
 * Who must approve what. For POs a policy applies when the PO value in EGP is >= minAmountEgp (and < maxAmountEgp
 * when set); every matching policy becomes a step, in stepOrder. BOQ and AWARD policies have no amounts.
 */
export const approvalPolicies = pgTable("approval_policies", {
  id: serial("id").primaryKey(),
  entity: approvalEntity("entity").notNull(),
  label: text("label").notNull(),                       // "Procurement manager", "Hospital director"
  approverRole: userRole("approver_role").notNull(),
  minAmountEgp: money("min_amount_egp").notNull().default("0"),
  maxAmountEgp: money("max_amount_egp"),
  stepOrder: integer("step_order").notNull().default(1),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "cascade" }),  // null = all
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** One approval run for one record. A new run replaces a rejected or cancelled one. */
export const approvalRequests = pgTable("approval_requests", {
  id: serial("id").primaryKey(),
  entity: approvalEntity("entity").notNull(),
  entityId: integer("entity_id").notNull(),
  status: approvalStatus("status").notNull().default("PENDING"),
  title: text("title").notNull(),                       // "PO-2026-0007 · Philips · EGP 4.2M"
  href: text("href").notNull(),
  amountEgp: money("amount_egp"),
  facilityId: integer("facility_id").references(() => facilities.id, { onDelete: "set null" }),
  requestedById: integer("requested_by_id").references(() => users.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
}, (t) => [
  index("approval_requests_entity_idx").on(t.entity, t.entityId),
  // At most one open request per record: a double-click or two people submitting at once can't start two chains.
  uniqueIndex("approval_requests_one_pending_uq").on(t.entity, t.entityId).where(sql`status = 'PENDING'`),
]);

/**
 * Steps run in stepOrder; steps sharing an order run together (e.g. every committee member signs). A step is for a
 * role (anyone holding it) or a named user; external members without an account (Ministry of Finance, State Council)
 * have userId null + memberName, and their paper signature is recorded by a procurement user.
 */
export const approvalSteps = pgTable("approval_steps", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  label: text("label").notNull(),
  approverRole: userRole("approver_role"),
  approverUserId: integer("approver_user_id").references(() => users.id, { onDelete: "set null" }),
  memberName: text("member_name"),
  status: approvalStepStatus("status").notNull().default("WAITING"),
  decidedById: integer("decided_by_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  comment: text("comment"),
}, (t) => [index("approval_steps_request_idx").on(t.requestId)]);

export const committeeKind = pgEnum("committee_kind", ["OPENING", "ADJUDICATION", "COMBINED"]);
export const committeeCapacity = pgEnum("committee_capacity", [
  "CHAIR", "TECHNICAL", "FINANCIAL", "LEGAL", "MOF_REP", "STATE_COUNCIL_REP", "HOUSING_REP", "SECRETARY", "MEMBER",
]);

/** Tender committees (Law 182/2018 art. 28–29): envelope opening + adjudication, or one combined ≤ EGP 300,000. */
export const committees = pgTable("committees", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: committeeKind("kind").notNull(),
  decisionRef: text("decision_ref"),                     // the competent authority's formation decision no.
  formedOn: date("formed_on"),
  dueBy: date("due_by"),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("committees_project_kind_uq").on(t.projectId, t.kind)]);

export const committeeMembers = pgTable("committee_members", {
  id: serial("id").primaryKey(),
  committeeId: integer("committee_id").notNull().references(() => committees.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  capacity: committeeCapacity("capacity").notNull().default("MEMBER"),
  /** Secretaries record minutes but don't vote/sign the recommendation. */
  votes: boolean("votes").notNull().default(true),
}, (t) => [index("committee_members_committee_idx").on(t.committeeId)]);

/** In-app notifications. dedupeKey stops the alert generator repeating itself. */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 48 }).notNull(),        // "approval_needed" | "offer_expiring" | …
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  dedupeKey: varchar("dedupe_key", { length: 160 }),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
}, (t) => [
  index("notifications_user_idx").on(t.userId, t.readAt),
  uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey),
]);

/* ───────────────────────────── Relations ───────────────────────────── */

export const facilitiesRelations = relations(facilities, ({ many }) => ({
  buildings: many(buildings), departments: many(departments), assets: many(assets),
}));
export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  facility: one(facilities, { fields: [buildings.facilityId], references: [facilities.id] }),
  floors: many(floors),
}));
export const floorsRelations = relations(floors, ({ one, many }) => ({
  building: one(buildings, { fields: [floors.buildingId], references: [buildings.id] }),
  rooms: many(rooms),
}));
export const departmentTypesRelations = relations(departmentTypes, ({ many }) => ({
  departments: many(departments), rules: many(boqRules),
}));
export const departmentsRelations = relations(departments, ({ one, many }) => ({
  facility: one(facilities, { fields: [departments.facilityId], references: [facilities.id] }),
  departmentType: one(departmentTypes, { fields: [departments.departmentTypeCode], references: [departmentTypes.code] }),
  rooms: many(rooms), assets: many(assets),
}));
export const roomsRelations = relations(rooms, ({ one, many }) => ({
  floor: one(floors, { fields: [rooms.floorId], references: [floors.id] }),
  department: one(departments, { fields: [rooms.departmentId], references: [departments.id] }),
  assets: many(assets),
}));
export const deviceTypesRelations = relations(deviceTypes, ({ one, many }) => ({
  parent: one(deviceTypes, { fields: [deviceTypes.parentId], references: [deviceTypes.id], relationName: "taxonomy" }),
  children: many(deviceTypes, { relationName: "taxonomy" }),
  assets: many(assets), rules: many(boqRules),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  offers: many(offers), purchaseOrders: many(purchaseOrders),
}));
export const standardSetsRelations = relations(standardSets, ({ many }) => ({ rules: many(boqRules) }));
export const boqRulesRelations = relations(boqRules, ({ one }) => ({
  standardSet: one(standardSets, { fields: [boqRules.standardSetId], references: [standardSets.id] }),
  departmentType: one(departmentTypes, { fields: [boqRules.departmentTypeCode], references: [departmentTypes.code] }),
  deviceType: one(deviceTypes, { fields: [boqRules.deviceTypeId], references: [deviceTypes.id] }),
}));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  facility: one(facilities, { fields: [projects.facilityId], references: [facilities.id] }),
  boqs: many(boqs), rfqs: many(rfqs), offers: many(offers), specs: many(techSpecs), purchaseOrders: many(purchaseOrders),
}));
export const boqsRelations = relations(boqs, ({ one, many }) => ({
  facility: one(facilities, { fields: [boqs.facilityId], references: [facilities.id] }),
  project: one(projects, { fields: [boqs.projectId], references: [projects.id] }),
  standardSet: one(standardSets, { fields: [boqs.standardSetId], references: [standardSets.id] }),
  departments: many(boqDepartments), lines: many(boqLines),
}));
export const boqDepartmentsRelations = relations(boqDepartments, ({ one, many }) => ({
  boq: one(boqs, { fields: [boqDepartments.boqId], references: [boqs.id] }),
  departmentType: one(departmentTypes, { fields: [boqDepartments.departmentTypeCode], references: [departmentTypes.code] }),
  lines: many(boqLines),
}));
export const boqLinesRelations = relations(boqLines, ({ one }) => ({
  boq: one(boqs, { fields: [boqLines.boqId], references: [boqs.id] }),
  boqDepartment: one(boqDepartments, { fields: [boqLines.boqDepartmentId], references: [boqDepartments.id] }),
  deviceType: one(deviceTypes, { fields: [boqLines.deviceTypeId], references: [deviceTypes.id] }),
  rule: one(boqRules, { fields: [boqLines.ruleId], references: [boqRules.id] }),
}));
export const techSpecsRelations = relations(techSpecs, ({ one, many }) => ({
  project: one(projects, { fields: [techSpecs.projectId], references: [projects.id] }),
  deviceType: one(deviceTypes, { fields: [techSpecs.deviceTypeId], references: [deviceTypes.id] }),
  items: many(specItems),
}));
export const specItemsRelations = relations(specItems, ({ one }) => ({
  spec: one(techSpecs, { fields: [specItems.specId], references: [techSpecs.id] }),
}));
export const rfqsRelations = relations(rfqs, ({ one, many }) => ({
  project: one(projects, { fields: [rfqs.projectId], references: [projects.id] }),
  boq: one(boqs, { fields: [rfqs.boqId], references: [boqs.id] }),
  suppliers: many(rfqSuppliers), offers: many(offers), lines: many(rfqLines),
}));
export const rfqLinesRelations = relations(rfqLines, ({ one }) => ({
  rfq: one(rfqs, { fields: [rfqLines.rfqId], references: [rfqs.id] }),
  deviceType: one(deviceTypes, { fields: [rfqLines.deviceTypeId], references: [deviceTypes.id] }),
}));
export const rfqSuppliersRelations = relations(rfqSuppliers, ({ one }) => ({
  rfq: one(rfqs, { fields: [rfqSuppliers.rfqId], references: [rfqs.id] }),
  supplier: one(suppliers, { fields: [rfqSuppliers.supplierId], references: [suppliers.id] }),
}));
export const offersRelations = relations(offers, ({ one, many }) => ({
  project: one(projects, { fields: [offers.projectId], references: [projects.id] }),
  rfq: one(rfqs, { fields: [offers.rfqId], references: [rfqs.id] }),
  supplier: one(suppliers, { fields: [offers.supplierId], references: [suppliers.id] }),
  lines: many(offerLines),
}));
export const offerLinesRelations = relations(offerLines, ({ one, many }) => ({
  offer: one(offers, { fields: [offerLines.offerId], references: [offers.id] }),
  boqLine: one(boqLines, { fields: [offerLines.boqLineId], references: [boqLines.id] }),
  deviceType: one(deviceTypes, { fields: [offerLines.deviceTypeId], references: [deviceTypes.id] }),
  spec: one(techSpecs, { fields: [offerLines.specId], references: [techSpecs.id] }),
  compliance: many(offerCompliance),
}));
export const offerComplianceRelations = relations(offerCompliance, ({ one }) => ({
  offerLine: one(offerLines, { fields: [offerCompliance.offerLineId], references: [offerLines.id] }),
  specItem: one(specItems, { fields: [offerCompliance.specItemId], references: [specItems.id] }),
}));
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  project: one(projects, { fields: [purchaseOrders.projectId], references: [projects.id] }),
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  offer: one(offers, { fields: [purchaseOrders.offerId], references: [offers.id] }),
  facility: one(facilities, { fields: [purchaseOrders.facilityId], references: [facilities.id] }),
  lines: many(poLines), deliveries: many(deliveries),
}));
export const poLinesRelations = relations(poLines, ({ one, many }) => ({
  po: one(purchaseOrders, { fields: [poLines.poId], references: [purchaseOrders.id] }),
  offerLine: one(offerLines, { fields: [poLines.offerLineId], references: [offerLines.id] }),
  deviceType: one(deviceTypes, { fields: [poLines.deviceTypeId], references: [deviceTypes.id] }),
  destinationDepartment: one(departments, { fields: [poLines.destinationDepartmentId], references: [departments.id] }),
  assets: many(assets),
}));
export const deliveriesRelations = relations(deliveries, ({ one, many }) => ({
  po: one(purchaseOrders, { fields: [deliveries.poId], references: [purchaseOrders.id] }),
  lines: many(deliveryLines),
}));
export const deliveryLinesRelations = relations(deliveryLines, ({ one }) => ({
  delivery: one(deliveries, { fields: [deliveryLines.deliveryId], references: [deliveries.id] }),
  poLine: one(poLines, { fields: [deliveryLines.poLineId], references: [poLines.id] }),
}));
export const assetsRelations = relations(assets, ({ one, many }) => ({
  deviceType: one(deviceTypes, { fields: [assets.deviceTypeId], references: [deviceTypes.id] }),
  facility: one(facilities, { fields: [assets.facilityId], references: [facilities.id] }),
  department: one(departments, { fields: [assets.departmentId], references: [departments.id] }),
  room: one(rooms, { fields: [assets.roomId], references: [rooms.id] }),
  supplier: one(suppliers, { fields: [assets.supplierId], references: [suppliers.id] }),
  poLine: one(poLines, { fields: [assets.poLineId], references: [poLines.id] }),
  parent: one(assets, { fields: [assets.parentAssetId], references: [assets.id], relationName: "components" }),
  components: many(assets, { relationName: "components" }),
  movements: many(assetMovements), maintenance: many(maintenanceEvents), workOrders: many(workOrders),
}));
export const assetMovementsRelations = relations(assetMovements, ({ one }) => ({
  asset: one(assets, { fields: [assetMovements.assetId], references: [assets.id] }),
  fromRoom: one(rooms, { fields: [assetMovements.fromRoomId], references: [rooms.id], relationName: "fromRoom" }),
  toRoom: one(rooms, { fields: [assetMovements.toRoomId], references: [rooms.id], relationName: "toRoom" }),
}));
export const maintenanceEventsRelations = relations(maintenanceEvents, ({ one }) => ({
  asset: one(assets, { fields: [maintenanceEvents.assetId], references: [assets.id] }),
  vendor: one(suppliers, { fields: [maintenanceEvents.vendorId], references: [suppliers.id] }),
}));
export const workOrdersRelations = relations(workOrders, ({ one }) => ({
  asset: one(assets, { fields: [workOrders.assetId], references: [assets.id] }),
  facility: one(facilities, { fields: [workOrders.facilityId], references: [facilities.id] }),
  maintenanceEvent: one(maintenanceEvents, { fields: [workOrders.maintenanceEventId], references: [maintenanceEvents.id] }),
}));
export const serviceContractsRelations = relations(serviceContracts, ({ one, many }) => ({
  facility: one(facilities, { fields: [serviceContracts.facilityId], references: [facilities.id] }),
  supplier: one(suppliers, { fields: [serviceContracts.supplierId], references: [suppliers.id] }),
  assets: many(serviceContractAssets),
}));
export const serviceContractAssetsRelations = relations(serviceContractAssets, ({ one }) => ({
  contract: one(serviceContracts, { fields: [serviceContractAssets.contractId], references: [serviceContracts.id] }),
  asset: one(assets, { fields: [serviceContractAssets.assetId], references: [assets.id] }),
}));

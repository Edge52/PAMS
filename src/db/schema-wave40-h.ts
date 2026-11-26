/**
 * Wave 40 (agent H): GAHAR readiness — the yearly medical equipment management plan and its evaluation (EFS.10
 * EOC 1), backups for critical devices, and the in-house contact on a device's equipment ID card (EFS.10 EOC 4).
 * Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated, so its tables and enums can't be used at the top level here.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { assets, departments, deviceTypes, facilities, users } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/** A KPI of the plan with its target (src/lib/compliance/equipment-plan.ts has the keys and the rules). */
export type PlanKpi = { key: string; label: string; target: number; unit: "%" | "count" };
/** KPI values worked out when a review is recorded: null = no figure in PAMS for that period. */
export type PlanKpiSnapshot = { key: string; label: string; target: number; unit: "%" | "count"; value: number | null; met: boolean | null }[];

/** DRAFT → SUBMITTED (approvals engine, entity EQUIPMENT_PLAN) → APPROVED; a rejection or withdrawal goes back to DRAFT. */
export const equipmentPlanStatus = pgEnum("equipment_plan_status", ["DRAFT", "SUBMITTED", "APPROVED"]);

/** The hospital's medical equipment management plan for one year (GAHAR EFS.10 EOC 1). A new version replaces the last. */
export const equipmentPlans = pgTable("equipment_plans", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  year: integer("year").notNull(),
  version: integer("version").notNull().default(1),
  scope: text("scope").notNull(),
  /** How devices are ranked for maintenance (e.g. the risk score of function, physical risk and maintenance need). */
  riskMethod: text("risk_method").notNull(),
  /** Maintenance strategy policy: PPM by risk, maker's intervals, run to failure for low-risk items… */
  maintenanceStrategy: text("maintenance_strategy").notNull(),
  kpis: jsonb("kpis").$type<PlanKpi[]>().notNull().default(sql`'[]'::jsonb`),
  notes: text("notes"),
  status: equipmentPlanStatus("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("equipment_plans_facility_year_version_uq").on(t.facilityId, t.year, t.version),
  check("equipment_plans_year_check", sql`${t.year} between 2000 and 2100`),
  check("equipment_plans_version_check", sql`${t.version} >= 1`),
]);

/** The yearly evaluation of a plan: KPI figures as they stood when it was recorded, findings and actions. */
export const equipmentPlanReviews = pgTable("equipment_plan_reviews", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => equipmentPlans.id, { onDelete: "restrict" }),
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  kpiSnapshot: jsonb("kpi_snapshot").$type<PlanKpiSnapshot>().notNull(),
  findings: text("findings"),
  actions: text("actions"),
  reviewedById: integer("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  reviewedByName: text("reviewed_by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("equipment_plan_reviews_plan_idx").on(t.planId),
  check("equipment_plan_reviews_period_check", sql`${t.periodTo} >= ${t.periodFrom}`),
]);

/**
 * How many backups a department must keep of a critical device type: units normally in use plus backups must be
 * working (installed or in service). Shortfalls and the "last backup gone" alert come from src/lib/compliance/critical-backup.ts.
 */
export const criticalBackups = pgTable("critical_backups", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  departmentId: integer("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  deviceTypeId: integer("device_type_id").notNull().references(() => deviceTypes.id),
  inUseCount: integer("in_use_count").notNull().default(1),
  backupCount: integer("backup_count").notNull().default(1),
  notes: text("notes"),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("critical_backups_department_type_uq").on(t.departmentId, t.deviceTypeId),
  index("critical_backups_facility_idx").on(t.facilityId),
  check("critical_backups_counts_check", sql`${t.inUseCount} between 0 and 500 and ${t.backupCount} between 0 and 500`),
]);

/**
 * Equipment ID card extras for one device: the in-house contact (who in the hospital looks after it) and, when the
 * supplier's records don't have it, the vendor's emergency service line. Vendor and contract come from suppliers,
 * supplier_contacts and service_contracts.
 */
export const equipmentIdCards = pgTable("equipment_id_cards", {
  assetId: integer("asset_id").primaryKey().references(() => assets.id, { onDelete: "restrict" }),
  inHouseName: text("in_house_name"),
  inHousePhone: varchar("in_house_phone", { length: 64 }),
  vendorPhone: varchar("vendor_phone", { length: 64 }),
  showOnLabel: boolean("show_on_label").notNull().default(false),
  updatedAt: updatedAt(),
});

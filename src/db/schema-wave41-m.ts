/**
 * Wave 41 (agent M): utilities and water (GAHAR 2025 EFS.11 and EFS.12; ECRI 2026 hazards 2 and 10).
 *
 * A utility system is an ordinary asset (so planned maintenance, work orders, documents, the 3D view and QR labels
 * work for it) with one `utility_systems` row: the asset's class flag, its kind and the figures its tests are judged
 * by. Scheduled tests and their results are in `utility_tests`; a failed test opens a work order. Water quality:
 * sampling points (`water_points`, with their limits) and results (`water_samples`). Rules are pure in
 * src/lib/utilities/utilities.ts and src/lib/utilities/water.ts. Medical gas purity tests and pipeline certification
 * stay with the contractor: their certificates are documents on the system's asset.
 *
 * Re-exported from ./schema at its very end; only lazy references to tables in ./schema.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { assets, facilities, rooms, users, workOrders } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/** The asset is a utility system (one row per asset). Kind and pressure take the values in lib/utilities/utilities.ts. */
export const utilitySystems = pgTable("utility_systems", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  kind: varchar("kind", { length: 24 }).notNull(),
  /** What it serves, e.g. "Theatres 1–4 and ICU". */
  serves: text("serves"),
  /** A system patients depend on: failures and missed tests are alerted. */
  critical: boolean("critical").notNull().default(true),
  /** Generator rating (kW): a load test must reach 30 % of it. */
  ratedKw: real("rated_kw"),
  /** UPS: autonomy needed (minutes). */
  requiredMinutes: real("required_minutes"),
  /** Generator: lowest fuel level allowed (%). */
  minFuelPct: real("min_fuel_pct"),
  /** Cold chain: allowed range (°C). */
  tempLow: real("temp_low"),
  tempHigh: real("temp_high"),
  /** Theatre or isolation air handling: air changes per hour needed, room pressure (POSITIVE, NEGATIVE, NONE) and the least difference (Pa). */
  requiredAch: real("required_ach"),
  pressure: varchar("pressure", { length: 8 }),
  minPressurePa: real("min_pressure_pa"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("utility_systems_asset_uq").on(t.assetId),
  index("utility_systems_facility_idx").on(t.facilityId),
  check("utility_systems_figures_check", sql`(${t.ratedKw} is null or ${t.ratedKw} > 0) and (${t.requiredMinutes} is null or ${t.requiredMinutes} >= 0)
    and (${t.minFuelPct} is null or ${t.minFuelPct} between 0 and 100) and (${t.requiredAch} is null or ${t.requiredAch} >= 0)
    and (${t.minPressurePa} is null or ${t.minPressurePa} >= 0) and (${t.tempLow} is null or ${t.tempHigh} is null or ${t.tempHigh} > ${t.tempLow})`),
]);

/** One test of a utility system with its readings and result. Kind takes the values in lib/utilities/utilities.ts. */
export const utilityTests = pgTable("utility_tests", {
  id: serial("id").primaryKey(),
  systemId: integer("system_id").notNull().references(() => utilitySystems.id, { onDelete: "restrict" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  kind: varchar("kind", { length: 24 }).notNull(),
  testedOn: date("tested_on").notNull(),
  loadKw: real("load_kw"),
  durationMin: real("duration_min"),
  transferSec: real("transfer_sec"),
  fuelPct: real("fuel_pct"),
  autonomyMin: real("autonomy_min"),
  tempMin: real("temp_min"),
  tempMax: real("temp_max"),
  excursionMin: real("excursion_min"),
  airChanges: real("air_changes"),
  pressurePa: real("pressure_pa"),
  /** Checks done and all right (started, alarms sounded, tank cleaned and sampled…). Null = not asked. */
  checksOk: boolean("checks_ok"),
  passed: boolean("passed").notNull(),
  problems: text("problems").array().notNull().default(sql`'{}'::text[]`),
  notes: text("notes"),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("utility_tests_system_idx").on(t.systemId, t.kind, t.testedOn),
  index("utility_tests_facility_idx").on(t.facilityId, t.testedOn),
  check("utility_tests_readings_check", sql`(${t.loadKw} is null or ${t.loadKw} >= 0) and (${t.durationMin} is null or ${t.durationMin} >= 0)
    and (${t.transferSec} is null or ${t.transferSec} >= 0) and (${t.fuelPct} is null or ${t.fuelPct} between 0 and 100)
    and (${t.autonomyMin} is null or ${t.autonomyMin} >= 0) and (${t.excursionMin} is null or ${t.excursionMin} >= 0)
    and (${t.airChanges} is null or ${t.airChanges} >= 0)`),
]);

/** A water sampling point with its limits (defaults by kind in lib/utilities/water.ts; editable). */
export const waterPoints = pgTable("water_points", {
  id: serial("id").primaryKey(),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  name: text("name").notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  /** The plant, machine or tank sampled: a failed result opens a work order on it. */
  assetId: integer("asset_id").references(() => assets.id, { onDelete: "restrict" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  everyDays: integer("every_days").notNull().default(30),
  tvcAction: real("tvc_action"),
  tvcLimit: real("tvc_limit"),
  endotoxinAction: real("endotoxin_action"),
  endotoxinLimit: real("endotoxin_limit"),
  /** Highest total chlorine (mg/L), e.g. dialysis water. */
  chlorineMax: real("chlorine_max"),
  /** Lowest free chlorine residual (mg/L), e.g. drinking water. */
  freeChlorineMin: real("free_chlorine_min"),
  /** Highest conductivity (µS/cm), e.g. sterilizer feed water. */
  conductivityMax: real("conductivity_max"),
  /** Highest coliforms (per 100 mL), e.g. 0 for drinking water. */
  coliformMax: real("coliform_max"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("water_points_facility_idx").on(t.facilityId),
  check("water_points_limits_check", sql`${t.everyDays} between 1 and 730
    and (${t.tvcAction} is null or ${t.tvcAction} >= 0) and (${t.tvcLimit} is null or ${t.tvcLimit} >= 0)
    and (${t.endotoxinAction} is null or ${t.endotoxinAction} >= 0) and (${t.endotoxinLimit} is null or ${t.endotoxinLimit} >= 0)
    and (${t.chlorineMax} is null or ${t.chlorineMax} >= 0) and (${t.freeChlorineMin} is null or ${t.freeChlorineMin} >= 0)
    and (${t.conductivityMax} is null or ${t.conductivityMax} >= 0) and (${t.coliformMax} is null or ${t.coliformMax} >= 0)`),
]);

/** One water sample's results. Level: OK, ACTION (at or over the action level) or FAIL (at or over the limit). */
export const waterSamples = pgTable("water_samples", {
  id: serial("id").primaryKey(),
  pointId: integer("point_id").notNull().references(() => waterPoints.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  sampledOn: date("sampled_on").notNull(),
  /** Total viable count (CFU/mL) and endotoxin (EU/mL). */
  tvc: real("tvc"),
  endotoxin: real("endotoxin"),
  chlorine: real("chlorine"),
  freeChlorine: real("free_chlorine"),
  conductivity: real("conductivity"),
  coliforms: real("coliforms"),
  /** Other chemical tests (the lab's panel) within limits. Null = not done. */
  chemistryOk: boolean("chemistry_ok"),
  lab: text("lab"),
  level: varchar("level", { length: 8 }).notNull(),
  problems: text("problems").array().notNull().default(sql`'{}'::text[]`),
  notes: text("notes"),
  workOrderId: integer("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  byId: integer("by_id").references(() => users.id, { onDelete: "set null" }),
  byName: text("by_name"),
  createdAt: createdAt(),
}, (t) => [
  index("water_samples_point_idx").on(t.pointId, t.sampledOn),
  index("water_samples_facility_idx").on(t.facilityId, t.sampledOn),
  check("water_samples_values_check", sql`(${t.tvc} is null or ${t.tvc} >= 0) and (${t.endotoxin} is null or ${t.endotoxin} >= 0)
    and (${t.chlorine} is null or ${t.chlorine} >= 0) and (${t.freeChlorine} is null or ${t.freeChlorine} >= 0)
    and (${t.conductivity} is null or ${t.conductivity} >= 0) and (${t.coliforms} is null or ${t.coliforms} >= 0)`),
]);

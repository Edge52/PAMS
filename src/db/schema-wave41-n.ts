/**
 * Wave 41 (agent N): device cybersecurity extras (IEC 80001-1:2021 risk per connection, SBOM key components per
 * model) and the read-only API (tokens and the call log). Re-exported from ./schema at its very end.
 *
 * Only lazy references (`() => assets.id`) to tables in ./schema: this file is loaded while ./schema is still being
 * evaluated. Rules: src/lib/assets/network-risk.ts, src/lib/api/tokens.ts.
 */
import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, serial, smallint, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { assets, deviceModels, facilities, users } from "./schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/* ───────────────────── Software bill of materials (SBOM) key components ───────────────────── */

/**
 * A key software component of a make and model (MDS2 / SBOM): the operating system, a database, a web server, a
 * library with known security notices. The SBOM file itself is a document of entity type "device_model", kind "sbom".
 */
export const modelSoftwareComponents = pgTable("model_software_components", {
  id: serial("id").primaryKey(),
  deviceModelId: integer("device_model_id").notNull().references(() => deviceModels.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: varchar("version", { length: 64 }),
  supplier: text("supplier"),
  /** Support of this component ends (no more security fixes); null = not known. */
  supportEnds: date("support_ends"),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("model_software_components_model_idx").on(t.deviceModelId)]);

/* ───────────────────── Network risk per connection (IEC 80001-1:2021) ───────────────────── */

/**
 * One connection of a device to another system (PACS, HIS, the supplier's remote service…) and its risk: hazard,
 * likelihood and severity 1–5 before the controls, the controls, and the residual likelihood and severity after them.
 */
export const networkRisks = pgTable("network_risks", {
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
  facilityId: integer("facility_id").notNull().references(() => facilities.id),
  connectsTo: text("connects_to").notNull(),
  dataExchanged: text("data_exchanged"),
  hazard: text("hazard").notNull(),
  likelihood: smallint("likelihood").notNull(),
  severity: smallint("severity").notNull(),
  controls: text("controls"),
  residualLikelihood: smallint("residual_likelihood").notNull(),
  residualSeverity: smallint("residual_severity").notNull(),
  owner: text("owner"),
  reviewDue: date("review_due"),
  /** OPEN, ACCEPTED (residual risk accepted by the owner), CLOSED (connection removed). */
  status: varchar("status", { length: 12 }).notNull().default("OPEN"),
  recordedById: integer("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
  recordedByName: text("recorded_by_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("network_risks_asset_idx").on(t.assetId), index("network_risks_facility_idx").on(t.facilityId, t.reviewDue),
  check("network_risks_scores_check", sql`${t.likelihood} between 1 and 5 and ${t.severity} between 1 and 5 and ${t.residualLikelihood} between 1 and 5 and ${t.residualSeverity} between 1 and 5`),
]);

/* ───────────────────── Read-only API ───────────────────── */

/**
 * An API token made by an administrator. Only the SHA-256 of the token is kept; the token is shown once.
 * `facilityIds` null = every hospital. Scopes: lib/api/tokens.ts SCOPES.
 */
export const apiTokens = pgTable("api_tokens", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** The first characters, to tell tokens apart in the list ("hpk_ab12…"). */
  prefix: varchar("prefix", { length: 16 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  facilityIds: integer("facility_ids").array(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name"),
  createdAt: createdAt(),
});

/** Every API call (the audit trail of the API), kept insert-only by the app. Also used for the rate limit. */
export const apiCalls = pgTable("api_calls", {
  id: serial("id").primaryKey(),
  tokenId: integer("token_id").references(() => apiTokens.id, { onDelete: "set null" }),
  path: text("path").notNull(),
  status: smallint("status").notNull(),
  rows: integer("rows"),
  ip: varchar("ip", { length: 64 }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("api_calls_token_at_idx").on(t.tokenId, t.at)]);

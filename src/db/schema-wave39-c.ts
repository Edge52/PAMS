/**
 * Wave 39 (agent C): earlier versions of attached documents, and the server error log (System › Errors).
 * Re-exported from ./schema at its very end; only lazy references (`() => documents.id`) to tables in ./schema.
 */
import { date, index, integer, pgTable, serial, smallint, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { documents, users } from "./schema";

/**
 * A file an attachment used to have. Uploading a new file to a document moves its current file here (the file stays
 * on disk) and the document points at the new one; documents.version counts up.
 */
export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  version: smallint("version").notNull(),
  fileName: text("file_name").notNull(),
  url: text("url").notNull(),
  sizeBytes: integer("size_bytes"),
  kind: varchar("kind", { length: 32 }),
  expiresOn: date("expires_on"),
  /** Who uploaded this file, when, and their note — copied from the document when it was replaced. */
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull(),
  uploadedById: integer("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  /** When a newer file replaced it, and who uploaded that one. */
  replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull().defaultNow(),
  replacedById: integer("replaced_by_id").references(() => users.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("document_versions_doc_version_idx").on(t.documentId, t.version), index("document_versions_url_idx").on(t.url)]);

/** Server errors caught by src/instrumentation.ts (onRequestError). Kept for 90 days. */
export const errorLog = pgTable("error_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** The request path (no query string) and the route file, e.g. /assets/42 and /assets/[id]. */
  path: text("path"),
  route: text("route"),
  method: varchar("method", { length: 12 }),
  /** render | route | action | proxy */
  kind: varchar("kind", { length: 16 }),
  message: text("message").notNull(),
  digest: varchar("digest", { length: 64 }),
  /** Shown to administrators only. */
  stack: text("stack"),
}, (t) => [index("error_log_at_idx").on(t.at)]);

"use server";
/**
 * Attachments for any entity (offers, POs, assets, specs, suppliers, projects, deliveries). OWNED BY THE LEAD.
 * Files are stored through src/lib/storage.ts (outside public/) and served by /files/... with safe headers.
 * Use <DocumentsPanel entityType="offer" entityId={id} /> from "@/components/documents-panel".
 */
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents, documentVersions } from "@/db/schema";
import { requirePermission } from "./auth/session";
import { requireDocumentEdit } from "./documents-access";
import { filesToRemove, nextVersion } from "./document-versions";
import { logActivity } from "./server-utils";
import { isISODate } from "./assets/dates";
import { ALLOWED_EXTENSIONS_LABEL, fileKind, removeStored, storeFile } from "./storage";

const ENTITY_TYPES = ["offer", "po", "asset", "spec", "supplier", "project", "delivery", "boq", "rfq", "work_order", "contract", "disposal", "twin_note", "facility", "framework", "training", "calibration", "radiation_licence", "competency"] as const;
const MAX_BYTES = 25 * 1024 * 1024;

export type UploadState = { error?: string; ok?: string } | null;

/**
 * Used with useActionState by the upload form in DocumentsPanel. Returns an error message instead of throwing.
 * Wave 39: with `documentId`, the file becomes a new version of that document and the old file is kept as a previous
 * version (with who uploaded it, when, and its note).
 */
export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = Number(formData.get("entityId"));
  const kind = (formData.get("kind") as string) || null;
  // Wave 27: an optional expiry date (licences, registrations, certificates).
  const expiresRaw = String(formData.get("expiresOn") ?? "").trim();
  if (expiresRaw && !isISODate(expiresRaw)) return { error: "The expiry date isn't a valid date." };
  const expiresOn = expiresRaw || null;
  const returnPath = String(formData.get("returnPath") ?? "/");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const replaceId = Number(formData.get("documentId") || 0);
  const file = formData.get("file");
  if (!(ENTITY_TYPES as readonly string[]).includes(entityType) || !Number.isInteger(entityId) || entityId <= 0) return { error: "This attachment has no valid target. Reload the page and try again." };
  const me = await requireDocumentEdit(entityType, entityId);
  if (!me) return { error: "That record no longer exists. Reload the page." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_BYTES) return { error: "Files must be 25 MB or smaller." };
  if (!fileKind(file.name)) return { error: `That file type isn't accepted. Upload ${ALLOWED_EXTENSIONS_LABEL}.` };

  let doc: typeof documents.$inferSelect | undefined;
  if (replaceId) {
    [doc] = await db.select().from(documents).where(and(eq(documents.id, replaceId), eq(documents.entityType, entityType), eq(documents.entityId, entityId), isNull(documents.deletedAt)));
    if (!doc) return { error: "That document no longer exists. Reload the page." };
  }
  const url = await storeFile(`${entityType}/${entityId}`, file.name, new Uint8Array(await file.arrayBuffer()));
  if (!doc) {
    await db.insert(documents).values({ entityType, entityId, kind, fileName: file.name, sizeBytes: file.size, url, expiresOn, note, uploadedById: me.id });
    await logActivity(entityType, entityId, "document_added", `Attached ${file.name}${expiresOn ? `, valid until ${expiresOn}` : ""}`, me.name);
  } else {
    const old = doc;
    const earlier = (await db.select({ v: documentVersions.version }).from(documentVersions).where(eq(documentVersions.documentId, old.id))).map((r) => r.v);
    const version = nextVersion(old.version, earlier);
    await db.transaction(async (tx) => {
      await tx.insert(documentVersions).values({ documentId: old.id, version: old.version, fileName: old.fileName, url: old.url, sizeBytes: old.sizeBytes, kind: old.kind,
        expiresOn: old.expiresOn, uploadedAt: old.uploadedAt, uploadedById: old.uploadedById, note: old.note, replacedById: me.id });
      // The type and expiry stay unless the form gives new ones.
      await tx.update(documents).set({ fileName: file.name, sizeBytes: file.size, url, version, note, uploadedById: me.id, uploadedAt: new Date(),
        ...(formData.has("kind") && kind ? { kind } : {}), ...(expiresOn ? { expiresOn } : {}) }).where(eq(documents.id, old.id));
      await logActivity(entityType, entityId, "document_version", `New version ${version} of ${old.fileName}: ${file.name}${note ? ` (${note})` : ""}`, me.name, tx);
    });
  }
  if (returnPath.startsWith("/")) revalidatePath(returnPath);
  return { ok: doc ? `${file.name} saved as a new version.` : `${file.name} attached.` };
}

/** Wave 39: removing hides the document (and keeps its files); an administrator can restore or purge it. */
export async function deleteDocument(formData: FormData) {
  const id = Number(formData.get("id"));
  const returnPath = String(formData.get("returnPath") ?? "/");
  const [target] = await db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  if (!target) return;
  const me = await requireDocumentEdit(target.entityType, target.entityId);
  if (!me) return;
  const [doc] = await db.update(documents).set({ deletedAt: new Date(), deletedById: me.id }).where(and(eq(documents.id, id), isNull(documents.deletedAt))).returning();
  if (doc) await logActivity(doc.entityType, doc.entityId, "document_removed", `Removed ${doc.fileName}`, me.name);
  if (returnPath.startsWith("/")) revalidatePath(returnPath);
}

/** Administrators: put a removed document back on its record. */
export async function restoreDocument(formData: FormData) {
  const me = await requirePermission("settings.manage");
  const id = Number(formData.get("id"));
  const [doc] = await db.update(documents).set({ deletedAt: null, deletedById: null }).where(and(eq(documents.id, id), isNotNull(documents.deletedAt))).returning();
  if (doc) await logActivity(doc.entityType, doc.entityId, "document_restored", `Restored ${doc.fileName}`, me.name);
  revalidatePath("/admin/documents");
}

/** Administrators: delete a removed document for good, with all its versions and the files nothing else uses. */
export async function purgeDocument(formData: FormData) {
  const me = await requirePermission("settings.manage");
  const id = Number(formData.get("id"));
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, id), isNotNull(documents.deletedAt)));
  if (!doc) return;
  const versions = await db.select({ url: documentVersions.url }).from(documentVersions).where(eq(documentVersions.documentId, doc.id));
  const own = [doc.url, ...versions.map((v) => v.url)];
  await db.transaction(async (tx) => {
    await tx.delete(documents).where(eq(documents.id, doc.id)); // versions go with it
    await logActivity(doc.entityType, doc.entityId, "document_purged", `Deleted ${doc.fileName} for good${versions.length ? ` with ${versions.length} earlier version${versions.length === 1 ? "" : "s"}` : ""}`, me.name, tx);
  });
  // Files shared with another document (a work order's photos come from a 3D note) stay.
  const [a, b] = await Promise.all([
    db.select({ url: documents.url }).from(documents).where(and(inArray(documents.url, own), ne(documents.id, doc.id))),
    db.select({ url: documentVersions.url }).from(documentVersions).where(inArray(documentVersions.url, own)),
  ]);
  for (const url of filesToRemove(own, [...a, ...b].map((r) => r.url))) await removeStored(url);
  revalidatePath("/admin/documents");
}

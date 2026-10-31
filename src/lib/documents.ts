"use server";
/**
 * Attachments for any entity (offers, POs, assets, specs, suppliers, projects, deliveries). OWNED BY THE LEAD.
 * Files are stored through src/lib/storage.ts (outside public/) and served by /files/... with safe headers.
 * Use <DocumentsPanel entityType="offer" entityId={id} /> from "@/components/documents-panel".
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { requireDocumentEdit } from "./documents-access";
import { logActivity } from "./server-utils";
import { ALLOWED_EXTENSIONS_LABEL, fileKind, storeFile } from "./storage";

const ENTITY_TYPES = ["offer", "po", "asset", "spec", "supplier", "project", "delivery", "boq", "rfq", "work_order", "contract", "disposal"] as const;
const MAX_BYTES = 25 * 1024 * 1024;

export type UploadState = { error?: string; ok?: string } | null;

/** Used with useActionState by the upload form in DocumentsPanel. Returns an error message instead of throwing. */
export async function uploadDocument(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = Number(formData.get("entityId"));
  const kind = (formData.get("kind") as string) || null;
  const returnPath = String(formData.get("returnPath") ?? "/");
  const file = formData.get("file");
  if (!(ENTITY_TYPES as readonly string[]).includes(entityType) || !Number.isInteger(entityId) || entityId <= 0) return { error: "This attachment has no valid target. Reload the page and try again." };
  if (!(await requireDocumentEdit(entityType, entityId))) return { error: "That record no longer exists. Reload the page." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_BYTES) return { error: "Files must be 25 MB or smaller." };
  if (!fileKind(file.name)) return { error: `That file type isn't accepted. Upload ${ALLOWED_EXTENSIONS_LABEL}.` };

  const url = await storeFile(`${entityType}/${entityId}`, file.name, new Uint8Array(await file.arrayBuffer()));
  await db.insert(documents).values({ entityType, entityId, kind, fileName: file.name, sizeBytes: file.size, url });
  await logActivity(entityType, entityId, "document_added", `Attached ${file.name}`);
  if (returnPath.startsWith("/")) revalidatePath(returnPath);
  return { ok: `${file.name} attached.` };
}

export async function deleteDocument(formData: FormData) {
  const id = Number(formData.get("id"));
  const returnPath = String(formData.get("returnPath") ?? "/");
  const [target] = await db.select().from(documents).where(eq(documents.id, id));
  if (!target || !(await requireDocumentEdit(target.entityType, target.entityId))) return;
  const [doc] = await db.delete(documents).where(eq(documents.id, id)).returning();
  if (doc) await logActivity(doc.entityType, doc.entityId, "document_removed", `Removed ${doc.fileName}`);
  if (returnPath.startsWith("/")) revalidatePath(returnPath);
}

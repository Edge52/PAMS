"use server";
/** Type and expiry date of a supplier document (wave 27). Needs `suppliers.edit`; suppliers are shared, so no facility check. */
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { diff, changeSummary } from "@/lib/audit-diff";
import { requirePermission } from "@/lib/auth/session";
import { formObject, isoDate, oneOf, reqId } from "@/lib/assets/forms";
import { SUPPLIER_DOC_KINDS } from "@/lib/procurement/supplier-docs";
import { fail, ok, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const Schema = z.object({ id: reqId("Document"), kind: oneOf("Document type", SUPPLIER_DOC_KINDS), expiresOn: isoDate("Valid until") });

export async function saveSupplierDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("suppliers.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, d.id), eq(documents.entityType, "supplier"), isNull(documents.deletedAt)));
  if (!doc) return fail("That document no longer exists. Reload the page.");
  const next = { kind: d.kind ?? doc.kind, expiresOn: d.expiresOn ?? null };
  const changes = diff({ kind: doc.kind, expiresOn: doc.expiresOn }, next);
  if (!changes) return ok("No change.");
  await db.update(documents).set(next).where(eq(documents.id, doc.id));
  await logActivity("supplier", doc.entityId, "document_updated", `${doc.fileName}: ${changeSummary(changes)}`, me.name, undefined, changes);
  revalidatePath(`/procurement/suppliers/${doc.entityId}`);
  revalidatePath("/procurement/suppliers/documents");
  return ok(`${doc.fileName} saved.`);
}

"use server";
/**
 * Wave 41: bulk actions on the documents list. Removing hides documents (their files stay, as one at a time);
 * restoring puts removed ones back. Each document is checked against its record (permission and hospital) and logged.
 */
import { and, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { EDIT_PERMISSION, facilityOfEntity } from "@/lib/documents-access";
import { bulkIds } from "@/lib/bulk";
import { logActivity } from "@/lib/server-utils";

function back(fd: FormData, key: "notice" | "error", msg: string): never {
  const rp = String(fd.get("returnPath") ?? "");
  const base = rp.startsWith("/admin/documents") && !rp.includes("//") ? rp.replace(/[?&](notice|error)=[^&]*/g, "") : "/admin/documents";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

/** Remove (hide) the ticked documents. */
export async function bulkRemoveDocumentsAction(fd: FormData): Promise<void> {
  const me = await requirePermission("settings.manage");
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the documents first.");
  const rows = await db.select().from(documents).where(and(inArray(documents.id, ids), isNull(documents.deletedAt)));
  const scope = await facilityScope(me);
  const skipped: string[] = [];
  const ok: typeof rows = [];
  for (const d of rows) {
    // The same rule as removing one: the record's edit permission and its hospital.
    const perm = EDIT_PERMISSION[d.entityType as keyof typeof EDIT_PERMISSION];
    const f = await facilityOfEntity(d.entityType, d.entityId);
    if (!perm || !can(me.role, perm) || f === undefined || (f !== null && scope !== null && !scope.includes(f))) { skipped.push(d.fileName); continue; }
    ok.push(d);
  }
  if (ok.length) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(documents).set({ deletedAt: now, deletedById: me.id }).where(and(inArray(documents.id, ok.map((d) => d.id)), isNull(documents.deletedAt)));
      for (const d of ok) await logActivity(d.entityType, d.entityId, "document_removed", `Removed ${d.fileName} (bulk)`, me.name, tx);
    });
  }
  revalidatePath("/admin/documents");
  const gone = ids.length - rows.length;
  const alone = [...skipped, ...(gone ? [`${gone} already removed`] : [])];
  back(fd, ok.length ? "notice" : "error", `${ok.length} document${ok.length === 1 ? "" : "s"} removed. The files are kept until deleted for good.${alone.length ? ` Left alone: ${alone.slice(0, 5).join(", ")}${alone.length > 5 ? ` and ${alone.length - 5} more` : ""}.` : ""}`);
}

/** Put the ticked removed documents back on their records. */
export async function bulkRestoreDocumentsAction(fd: FormData): Promise<void> {
  const me = await requirePermission("settings.manage");
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the documents first.");
  const rows = await db.update(documents).set({ deletedAt: null, deletedById: null }).where(and(inArray(documents.id, ids), isNotNull(documents.deletedAt))).returning();
  for (const d of rows) await logActivity(d.entityType, d.entityId, "document_restored", `Restored ${d.fileName} (bulk)`, me.name);
  revalidatePath("/admin/documents");
  back(fd, "notice", `${rows.length} document${rows.length === 1 ? "" : "s"} restored.`);
}

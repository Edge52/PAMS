"use server";
/** Wave 41: bulk actions on a recall's devices. Only devices in the user's hospitals change; each is logged. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, recallAssets, recalls } from "@/db/schema";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { bulkIds, bulkNotice, parseBulk, RecallBulkSchema } from "@/lib/bulk";
import { logActivity } from "@/lib/server-utils";

const back = (rid: number, key: "notice" | "error", msg: string): never => redirect(`/assets/recalls/${rid}?${key}=${encodeURIComponent(msg)}`);

/** Mark the ticked devices dealt with (or not affected, with a reason). */
export async function bulkRecallDevicesAction(fd: FormData): Promise<void> {
  const me = await requirePermission("recalls.edit");
  const recallId = Number(fd.get("recallId"));
  if (!Number.isInteger(recallId) || recallId <= 0) redirect("/assets/recalls");
  const ids = bulkIds(fd, "assetIds");
  if (!ids.length) back(recallId, "error", "Tick the devices first.");
  const p = parseBulk(RecallBulkSchema, fd, ["status", "note"]);
  if ("error" in p) return back(recallId, "error", p.error);
  if (p.data.status === "NOT_AFFECTED" && !p.data.note) back(recallId, "error", "Say why the devices aren't affected (for example: serials outside the batch).");
  const [recall] = await db.select({ status: recalls.status }).from(recalls).where(eq(recalls.id, recallId));
  if (!recall) redirect("/assets/recalls");
  if (recall.status !== "OPEN") back(recallId, "error", "This recall is closed.");
  const scope = await facilityScope(me);
  const rows = await db.select({ assetId: recallAssets.assetId, tag: assets.assetTag, status: recallAssets.status }).from(recallAssets)
    .innerJoin(assets, eq(assets.id, recallAssets.assetId))
    .where(and(eq(recallAssets.recallId, recallId), inArray(recallAssets.assetId, ids),
      scope === null ? undefined : scope.length ? inArray(assets.facilityId, scope) : sql`false`));
  const change = rows.filter((r) => r.status !== p.data.status);
  const skipped = ids.length - change.length;
  if (change.length) {
    const label = p.data.status === "ACTIONED" ? "dealt with" : "not affected";
    await db.transaction(async (tx) => {
      await tx.update(recallAssets).set({ status: p.data.status, note: p.data.note ?? null, actionedAt: new Date() })
        .where(and(eq(recallAssets.recallId, recallId), inArray(recallAssets.assetId, change.map((r) => r.assetId))));
      for (const r of change) await logActivity("recall", recallId, "device", `${r.tag} marked ${label}${p.data.note ? ` — ${p.data.note}` : ""} (bulk)`, me.name, tx);
    });
  }
  revalidatePath(`/assets/recalls/${recallId}`);
  revalidatePath("/assets/recalls");
  back(recallId, "notice", bulkNotice(change.length, change.length === 1 ? "device" : "devices", skipped ? [`${skipped} already so, or not in your hospitals`] : []));
}

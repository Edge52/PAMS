"use server";
/**
 * Wave 41: bulk changes to ticked assets in the register: move to a department or room, set criticality, plan a PPM
 * visit. Only assets in the user's hospitals change; every asset changed gets its own audit entry.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, maintenanceEvents } from "@/db/schema";
import { facilityScope, requirePermission } from "@/lib/auth/session";
import { scopeWhere } from "@/lib/assets/access";
import { moveAsset } from "@/lib/assets/mutations";
import { AssetBulkSchema, bulkIds, bulkNotice, parseBulk } from "@/lib/bulk";
import { logActivity } from "@/lib/server-utils";
import { humanize } from "@/lib/status";

function back(fd: FormData, key: "notice" | "error", msg: string): never {
  const rp = String(fd.get("returnPath") ?? "");
  const base = rp.startsWith("/assets") && !rp.includes("//") ? rp.replace(/[?&](notice|error)=[^&]*/g, "") : "/assets";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(msg)}`);
}

/** The ticked assets that are in the user's hospitals. */
async function ticked(fd: FormData, me: Awaited<ReturnType<typeof requirePermission>>) {
  const ids = bulkIds(fd);
  if (!ids.length) back(fd, "error", "Tick the assets first.");
  const scope = await facilityScope(me);
  const rows = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, status: assets.status, criticality: assets.criticality })
    .from(assets).where(and(inArray(assets.id, ids), scopeWhere(assets.facilityId, scope)));
  return { rows, outside: ids.length - rows.length };
}

const withWhat = (fd: FormData, what: string) => { const out = new FormData(); for (const [k, v] of fd.entries()) out.append(k, v); out.set("what", what); return out; };

/** Move the ticked assets to one room (its department follows) or one department. Same hospital only. */
export async function bulkMoveAssetsAction(fd: FormData): Promise<void> {
  const me = await requirePermission("assets.move");
  const p = parseBulk(AssetBulkSchema, withWhat(fd, "location"), ["what", "departmentId", "roomId"]);
  if ("error" in p) return back(fd, "error", p.error);
  const { rows, outside } = await ticked(fd, me);
  const skipped: string[] = outside ? [`${outside} not in your hospitals`] : [];
  let moved = 0;
  for (const a of rows) {
    if (a.status === "DISPOSED") { skipped.push(`${a.tag} (disposed)`); continue; }
    const r = await moveAsset({ assetId: a.id, toRoomId: p.data.roomId ?? null, toDepartmentId: p.data.roomId ? null : p.data.departmentId ?? null, reason: "Bulk move from the register", movedBy: me.name });
    if (!r.ok) skipped.push(`${a.tag} (${r.error.replace(/\.$/, "")})`);
    else if (r.moved) moved++;
  }
  revalidatePath("/assets"); revalidatePath("/assets/map"); revalidatePath("/assets/3d");
  back(fd, moved ? "notice" : "error", `${moved} asset${moved === 1 ? "" : "s"} moved.${skipped.length ? ` Left alone: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ""}.` : ""}`);
}

/** One criticality for every ticked asset. */
export async function bulkCriticalityAction(fd: FormData): Promise<void> {
  const me = await requirePermission("assets.edit");
  const p = parseBulk(AssetBulkSchema, withWhat(fd, "criticality"), ["what", "criticality"]);
  if ("error" in p) return back(fd, "error", p.error);
  const crit = p.data.criticality!;
  const { rows, outside } = await ticked(fd, me);
  const change = rows.filter((a) => a.criticality !== crit && a.status !== "DISPOSED");
  if (change.length) {
    await db.transaction(async (tx) => {
      await tx.update(assets).set({ criticality: crit }).where(inArray(assets.id, change.map((a) => a.id)));
      for (const a of change) await logActivity("asset", a.id, "updated", `Criticality ${a.criticality ? humanize(a.criticality).toLowerCase() : "not set"} → ${humanize(crit).toLowerCase()} (bulk)`, me.name, tx,
        { criticality: { from: a.criticality, to: crit } });
    });
  }
  revalidatePath("/assets");
  const left = rows.length - change.length + outside;
  back(fd, "notice", bulkNotice(change.length, change.length === 1 ? "asset" : "assets", left ? [`${left} already so, disposed, or not in your hospitals`] : []));
}

/** Plan a PPM visit on one date for each ticked asset that has no PPM visit planned yet. */
export async function bulkSchedulePpmAction(fd: FormData): Promise<void> {
  const me = await requirePermission("maintenance.edit");
  const p = parseBulk(AssetBulkSchema, withWhat(fd, "ppm"), ["what", "ppmDate"]);
  if ("error" in p) return back(fd, "error", p.error);
  const date = p.data.ppmDate!;
  const { rows, outside } = await ticked(fd, me);
  const live = rows.filter((a) => a.status !== "DISPOSED");
  const open = live.length ? new Set((await db.select({ id: maintenanceEvents.assetId }).from(maintenanceEvents)
    .where(and(inArray(maintenanceEvents.assetId, live.map((a) => a.id)), eq(maintenanceEvents.type, "PPM"), sql`${maintenanceEvents.status} in ('SCHEDULED','IN_PROGRESS','OVERDUE')`))).map((r) => r.id)) : new Set<number>();
  const plan = live.filter((a) => !open.has(a.id));
  if (plan.length) {
    await db.transaction(async (tx) => {
      await tx.insert(maintenanceEvents).values(plan.map((a) => ({ assetId: a.id, type: "PPM" as const, status: "SCHEDULED" as const, scheduledDate: date })));
      for (const a of plan) await logActivity("asset", a.id, "maintenance", `Planned preventive maintenance scheduled for ${date} (bulk)`, me.name, tx);
    });
  }
  revalidatePath("/assets"); revalidatePath("/assets/maintenance");
  const skipped = [...(open.size ? [`${open.size} already have a PPM visit planned`] : []), ...(rows.length - live.length ? [`${rows.length - live.length} disposed`] : []), ...(outside ? [`${outside} not in your hospitals`] : [])];
  back(fd, plan.length ? "notice" : "error", `${plan.length} PPM visit${plan.length === 1 ? "" : "s"} scheduled for ${date}.${skipped.length ? ` Left alone: ${skipped.join(", ")}.` : ""}`);
}

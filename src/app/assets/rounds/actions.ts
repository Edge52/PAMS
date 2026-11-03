"use server";
/** Starting and finishing rounds and stock-takes (wave 12, D7). Results arrive through ./[id]/sync. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { assets, roundItems, rounds } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/assets/forms";
import { logActivity } from "@/lib/server-utils";

export async function startRoundAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.move");
  const facilityId = Number(fd.get("facilityId")), departmentId = Number(fd.get("departmentId")) || null;
  await requireFacilityAccess(facilityId, me);
  const kind = fd.get("kind") === "STOCKTAKE" ? "STOCKTAKE" as const : "ROUND" as const;
  if (kind === "STOCKTAKE" && !departmentId) return { error: "Choose the ward or department to stock-take." };
  const [r] = await db.insert(rounds).values({ facilityId, departmentId, kind, startedByName: me.name }).returning({ id: rounds.id });
  await logActivity("round", r.id, "started", `${kind === "STOCKTAKE" ? "Stock-take" : "Round"} started`, me.name);
  redirect(`/assets/rounds/${r.id}`);
}

/** Finish: devices expected but not seen are recorded as missing (stock-take) and listed. */
export async function finishRoundAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requirePermission("assets.move");
  const id = Number(fd.get("roundId"));
  const [r] = await db.select().from(rounds).where(eq(rounds.id, id));
  if (!r) return { error: "That round no longer exists." };
  await requireFacilityAccess(r.facilityId, me);
  if (r.finishedAt) return { error: "This round is already finished." };
  let missing = 0;
  if (r.kind === "STOCKTAKE" && r.departmentId) {
    const expected = (await db.select({ id: assets.id }).from(assets).where(and(eq(assets.facilityId, r.facilityId), eq(assets.departmentId, r.departmentId), sql`${assets.status} not in ('DISPOSED','IN_STOCK')`))).map((a) => a.id);
    const seen = new Set((expected.length ? await db.select({ id: roundItems.assetId }).from(roundItems).where(and(eq(roundItems.roundId, id), inArray(roundItems.assetId, expected))) : []).map((x) => x.id));
    const lost = expected.filter((a) => !seen.has(a));
    if (lost.length) await db.insert(roundItems).values(lost.map((assetId) => ({ roundId: id, assetId, result: "MISSING" as const, checkedAt: new Date() })));
    missing = lost.length;
  }
  await db.update(rounds).set({ finishedAt: new Date(), notes: String(fd.get("notes") ?? "").trim().slice(0, 2000) || null }).where(eq(rounds.id, id));
  await logActivity("round", id, "finished", `${r.kind === "STOCKTAKE" ? "Stock-take" : "Round"} finished${missing ? `: ${missing} device${missing === 1 ? "" : "s"} not found` : ""}`, me.name);
  revalidatePath(`/assets/rounds/${id}`);
  return { ok: missing ? `Finished. ${missing} device${missing === 1 ? " was" : "s were"} not found and ${missing === 1 ? "is" : "are"} listed as missing.` : "Finished." };
}

"use server";
/** Equipment ID card (wave 40): the in-house contact and, when the supplier's records have none, the vendor's line. */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, equipmentIdCards } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, reqId, text } from "@/lib/assets/forms";
import { phoneProblem } from "@/lib/compliance/id-card";
import { zodFail, type ActionState } from "@/lib/procurement/forms";
import { diff } from "@/lib/audit-diff";
import { logActivity } from "@/lib/server-utils";

const Schema = z.object({ assetId: reqId("Device"), inHouseName: text(200), inHousePhone: text(64), vendorPhone: text(64) });

export async function saveIdCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  for (const k of ["inHousePhone", "vendorPhone"] as const) {
    const bad = phoneProblem(d[k]);
    if (bad) return { errors: [bad], fields: { [k]: bad } };
  }
  const [a] = await db.select({ facilityId: assets.facilityId, tag: assets.assetTag }).from(assets).where(eq(assets.id, d.assetId));
  if (!a) return { errors: ["That device no longer exists."] };
  await requireFacilityAccess(a.facilityId, me);
  const [before] = await db.select().from(equipmentIdCards).where(eq(equipmentIdCards.assetId, d.assetId));
  const values = { inHouseName: d.inHouseName ?? null, inHousePhone: d.inHousePhone ?? null, vendorPhone: d.vendorPhone ?? null, showOnLabel: fd.get("showOnLabel") === "on" };
  await db.insert(equipmentIdCards).values({ assetId: d.assetId, ...values }).onConflictDoUpdate({ target: equipmentIdCards.assetId, set: values });
  const changes = diff(before ?? {}, values);
  await logActivity("asset", d.assetId, "id_card", `${a.tag}: equipment ID card contacts saved`, me.name, undefined, changes);
  revalidatePath(`/assets/${d.assetId}`);
  return { message: "Saved." };
}

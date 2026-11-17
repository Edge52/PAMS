"use server";
/**
 * Useful life and residual value (wave 27). On a device type they are the default for its devices (`catalogue.edit`:
 * types are shared by every hospital); on one device they override the type (`assets.edit` and access to its hospital).
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { assets, deviceTypes } from "@/db/schema";
import { diff, changeSummary } from "@/lib/audit-diff";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, int, num, reqId } from "@/lib/assets/forms";
import { fail, ok, zodFail, type ActionState } from "@/lib/procurement/forms";
import { logActivity } from "@/lib/server-utils";

const Terms = z.object({ id: reqId("Record"), lifeYears: int("Useful life", 1, 60), residualPct: num("Residual value", 0, 100) });

export async function saveTypeDepreciationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("catalogue.edit");
  const p = Terms.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [t] = await db.select({ id: deviceTypes.id, code: deviceTypes.code, name: deviceTypes.name, lifeExpectancyYears: deviceTypes.lifeExpectancyYears, residualPct: deviceTypes.residualPct })
    .from(deviceTypes).where(eq(deviceTypes.id, d.id));
  if (!t) return fail("That device type no longer exists.");
  const next = { lifeExpectancyYears: d.lifeYears ?? null, residualPct: d.residualPct ?? null };
  const changes = diff({ lifeExpectancyYears: t.lifeExpectancyYears, residualPct: t.residualPct }, next);
  await db.update(deviceTypes).set(next).where(eq(deviceTypes.id, t.id));
  await logActivity("device_type", t.id, "depreciation_saved", `${t.name}: ${changeSummary(changes) || "no change"}`, me.name, undefined, changes);
  revalidatePath(`/catalogue/${t.code}`);
  return ok("Useful life and residual value saved. Devices without their own figures use them.");
}

export async function saveAssetDepreciationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = Terms.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const [a] = await db.select({ id: assets.id, tag: assets.assetTag, facilityId: assets.facilityId, lifeExpectancyYears: assets.lifeExpectancyYears, residualPct: assets.residualPct })
    .from(assets).where(eq(assets.id, d.id));
  if (!a) return fail("That asset no longer exists.");
  await requireFacilityAccess(a.facilityId, me);
  const next = { lifeExpectancyYears: d.lifeYears ?? null, residualPct: d.residualPct ?? null };
  const changes = diff({ lifeExpectancyYears: a.lifeExpectancyYears, residualPct: a.residualPct }, next);
  await db.update(assets).set(next).where(eq(assets.id, a.id));
  await logActivity("asset", a.id, "depreciation_saved", `Useful life and residual value: ${changeSummary(changes) || "no change"}`, me.name, undefined, changes);
  revalidatePath(`/assets/${a.id}`);
  return ok("Saved. Leave a field empty to use the device type's figure.");
}

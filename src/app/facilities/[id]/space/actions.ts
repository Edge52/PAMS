"use server";
/** Space planning (wave 17): save the area schedule as a snapshot to compare with later, or remove one. */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { spaceSnapshots } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { logActivity } from "@/lib/server-utils";
import { toSnapshot } from "@/lib/assets/space-planning";
import { facilitySpace } from "@/lib/assets/space-planning-server";

export async function saveSnapshotAction(fd: FormData) {
  const me = await requirePermission("facilities.edit");
  const facilityId = Number(fd.get("facilityId"));
  if (!Number.isInteger(facilityId) || facilityId <= 0) redirect("/facilities");
  await requireFacilityAccess(facilityId, me);
  const name = String(fd.get("name") ?? "").trim().slice(0, 80) || `Snapshot ${new Date().toISOString().slice(0, 10)}`;
  const data = toSnapshot(await facilitySpace(facilityId));
  const [row] = await db.insert(spaceSnapshots).values({ facilityId, name, data, createdByName: me.name }).returning({ id: spaceSnapshots.id });
  await logActivity("facility", facilityId, "space_snapshot", `Space snapshot “${name}” saved`, me.name);
  revalidatePath(`/facilities/${facilityId}/space`);
  redirect(`/facilities/${facilityId}/space?compare=${row.id}&notice=${encodeURIComponent(`“${name}” saved. Change rooms or equipment, then come back to compare.`)}#compare`);
}

export async function deleteSnapshotAction(fd: FormData) {
  const me = await requirePermission("facilities.edit");
  const facilityId = Number(fd.get("facilityId")), id = Number(fd.get("id"));
  if (!Number.isInteger(facilityId) || !Number.isInteger(id)) redirect("/facilities");
  await requireFacilityAccess(facilityId, me);
  await db.delete(spaceSnapshots).where(and(eq(spaceSnapshots.id, id), eq(spaceSnapshots.facilityId, facilityId)));
  revalidatePath(`/facilities/${facilityId}/space`);
  redirect(`/facilities/${facilityId}/space?notice=${encodeURIComponent("Snapshot removed.")}`);
}

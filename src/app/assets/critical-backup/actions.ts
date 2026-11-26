"use server";
/** Backups for critical devices (wave 40): the backup count per department and device type. Needs `assets.edit`. */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { criticalBackups, departments, deviceTypes } from "@/db/schema";
import { requireFacilityAccess, requirePermission } from "@/lib/auth/session";
import { formObject, id, int, reqId, text } from "@/lib/assets/forms";
import { backupProblem } from "@/lib/compliance/critical-backup";
import { zodFail, type ActionState } from "@/lib/procurement/forms";
import { diff } from "@/lib/audit-diff";
import { logActivity } from "@/lib/server-utils";

const PATH = "/assets/critical-backup";
const Schema = z.object({
  departmentId: reqId("Department"), deviceTypeId: reqId("Device type"),
  inUseCount: int("Units in use", 0, 500), backupCount: int("Backups needed", 0, 500), notes: text(1000),
});

export async function saveCriticalBackupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = Schema.safeParse(formObject(fd));
  if (!p.success) return zodFail(p.error);
  const d = p.data;
  const problem = backupProblem(d.inUseCount, d.backupCount);
  if (problem) return { errors: [problem], fields: { backupCount: problem } };
  const [dep] = await db.select({ facilityId: departments.facilityId, name: departments.name }).from(departments).where(eq(departments.id, d.departmentId));
  if (!dep) return { errors: ["Choose a department."], fields: { departmentId: "Choose a department." } };
  await requireFacilityAccess(dep.facilityId, me);
  const [t] = await db.select({ name: deviceTypes.name, level: deviceTypes.level }).from(deviceTypes).where(eq(deviceTypes.id, d.deviceTypeId));
  if (!t || t.level !== 3) return { errors: ["Choose a device type."], fields: { deviceTypeId: "Choose a device type." } };
  const [before] = await db.select().from(criticalBackups).where(and(eq(criticalBackups.departmentId, d.departmentId), eq(criticalBackups.deviceTypeId, d.deviceTypeId)));
  const values = { facilityId: dep.facilityId, departmentId: d.departmentId, deviceTypeId: d.deviceTypeId, inUseCount: d.inUseCount!, backupCount: d.backupCount!, notes: d.notes ?? null };
  const [row] = await db.insert(criticalBackups).values(values)
    .onConflictDoUpdate({ target: [criticalBackups.departmentId, criticalBackups.deviceTypeId], set: { inUseCount: values.inUseCount, backupCount: values.backupCount, notes: values.notes } })
    .returning({ id: criticalBackups.id });
  const changes = before ? diff(before, values, ["inUseCount", "backupCount", "notes"]) : undefined;
  await logActivity("critical_backup", row.id, before ? "updated" : "created", `${dep.name}, ${t.name}: ${values.inUseCount} in use and ${values.backupCount} backup${values.backupCount === 1 ? "" : "s"} needed`, me.name, undefined, changes);
  revalidatePath(PATH);
  return { message: "Saved." };
}

export async function deleteCriticalBackupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requirePermission("assets.edit");
  const p = z.object({ id: id() }).safeParse(formObject(fd));
  if (!p.success || !p.data.id) return { errors: ["That setting no longer exists."] };
  const [r] = await db.select().from(criticalBackups).where(eq(criticalBackups.id, p.data.id));
  if (!r) return { errors: ["That setting no longer exists."] };
  await requireFacilityAccess(r.facilityId, me);
  await db.delete(criticalBackups).where(eq(criticalBackups.id, r.id));
  await logActivity("critical_backup", r.id, "deleted", "Backup setting removed", me.name);
  revalidatePath(PATH);
  return { message: "Removed." };
}

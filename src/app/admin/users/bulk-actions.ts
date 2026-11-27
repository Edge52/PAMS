"use server";
/** Wave 41: switch ticked users on or off, or give them one role. Administrators only; each change is logged. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { destroyAllSessions, requirePermission } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { bulkIds, bulkNotice, parseBulk, UserRoleSchema, usersBulkPlan } from "@/lib/bulk";
import { logActivity } from "@/lib/server-utils";

const back = (key: "notice" | "error", msg: string): never => redirect(`/admin/users?${key}=${encodeURIComponent(msg)}`);

async function load(fd: FormData) {
  const me = await requirePermission("users.manage");
  if (me.role !== "ADMIN") back("error", "Only an administrator can change several users at once.");
  const ids = bulkIds(fd);
  if (!ids.length) back("error", "Tick the users first.");
  const [rows, [{ n }]] = await Promise.all([
    db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).where(inArray(users.id, ids)),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.active, true))),
  ]);
  return { me, rows, admins: n };
}

async function setActive(fd: FormData, active: boolean) {
  const { me, rows, admins } = await load(fd);
  const plan = usersBulkPlan(rows, me.id, { active }, admins);
  if (plan.change.length) {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ active }).where(inArray(users.id, plan.change.map((u) => u.id)));
      for (const u of plan.change) {
        await logActivity("user", u.id, active ? "activated" : "deactivated", `${u.name} switched ${active ? "on" : "off"} (bulk)`, me.name, tx,
          { active: { from: !active, to: active } });
      }
    });
    if (!active) for (const u of plan.change) await destroyAllSessions(u.id);
  }
  revalidatePath("/admin/users");
  back("notice", bulkNotice(plan.change.length, plan.change.length === 1 ? "user" : "users", plan.skipped));
}

export async function bulkDeactivateUsersAction(fd: FormData): Promise<void> {
  await requirePermission("users.manage");
  await setActive(fd, false);
}

export async function bulkActivateUsersAction(fd: FormData): Promise<void> {
  await requirePermission("users.manage");
  await setActive(fd, true);
}

/** One role for every ticked user. An administrator sees every hospital, so "all facilities" goes with it. */
export async function bulkSetRoleAction(fd: FormData): Promise<void> {
  await requirePermission("users.manage");
  const p = parseBulk(UserRoleSchema, fd, ["role"]);
  if ("error" in p) return back("error", p.error);
  const { me, rows, admins } = await load(fd);
  const role = p.data.role;
  const plan = usersBulkPlan(rows, me.id, { role }, admins);
  if (plan.change.length) {
    await db.transaction(async (tx) => {
      await tx.update(users).set(role === "ADMIN" ? { role, allFacilities: true } : { role }).where(inArray(users.id, plan.change.map((u) => u.id)));
      for (const u of plan.change) {
        await logActivity("user", u.id, "updated", `Role ${ROLE_LABELS[u.role as Role] ?? u.role} → ${ROLE_LABELS[role]} (bulk)`, me.name, tx, { role: { from: u.role, to: role } });
      }
    });
  }
  revalidatePath("/admin/users");
  back("notice", bulkNotice(plan.change.length, plan.change.length === 1 ? "user" : "users", plan.skipped));
}

import "server-only";
/**
 * Department-scoped editing (wave 13, A11): a department head may edit pathways whose steps all sit in their
 * departments, and the access zones of their rooms. Everyone with flows.edit / facilities.edit keeps full rights.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { rooms, userDepartments } from "@/db/schema";
import { can, deptScopeAllows } from "./permissions";
import type { CurrentUser } from "./session";

export async function myDepartments(userId: number): Promise<Set<number>> {
  return new Set((await db.select({ d: userDepartments.departmentId }).from(userDepartments).where(eq(userDepartments.userId, userId))).map((r) => r.d));
}

/** The department each step sits in: its own, else its room's. */
export async function stepDepartments(steps: { departmentId: number | null; roomId: number | null }[]): Promise<(number | null)[]> {
  const roomIds = steps.filter((s) => s.departmentId == null && s.roomId != null).map((s) => s.roomId!);
  const roomDept = new Map(roomIds.length ? (await db.select({ id: rooms.id, d: rooms.departmentId }).from(rooms).where(inArray(rooms.id, roomIds))).map((r) => [r.id, r.d]) : []);
  return steps.map((s) => s.departmentId ?? (s.roomId != null ? roomDept.get(s.roomId) ?? null : null));
}

export async function canEditFlow(me: CurrentUser, steps: { departmentId: number | null; roomId: number | null }[]): Promise<boolean> {
  if (can(me.role, "flows.edit")) return true;
  if (me.role !== "DEPARTMENT_HEAD") return false;
  return deptScopeAllows(await myDepartments(me.id), await stepDepartments(steps));
}

export async function canEditRoomZone(me: CurrentUser, roomDepartmentId: number | null): Promise<boolean> {
  if (can(me.role, "facilities.edit")) return true;
  return me.role === "DEPARTMENT_HEAD" && roomDepartmentId != null && (await myDepartments(me.id)).has(roomDepartmentId);
}

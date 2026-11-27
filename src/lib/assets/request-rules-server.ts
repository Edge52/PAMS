import "server-only";
/** Wave 42: which departments have a department head (an active department head user looking after them). */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { userDepartments, users } from "@/db/schema";

export async function departmentsWithHead(departmentIds: (number | null)[]): Promise<Set<number>> {
  const ids = [...new Set(departmentIds.filter((d): d is number => d != null))];
  if (!ids.length) return new Set();
  const rows = await db.selectDistinct({ d: userDepartments.departmentId }).from(userDepartments).innerJoin(users, eq(users.id, userDepartments.userId))
    .where(and(inArray(userDepartments.departmentId, ids), eq(users.role, "DEPARTMENT_HEAD"), eq(users.active, true)));
  return new Set(rows.map((r) => r.d));
}

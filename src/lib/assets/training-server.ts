import "server-only";
/** Database side of user training records (wave 27). */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, trainingAttendees, trainingSessions, userDepartments, userFacilities, users } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { matchDepartment, parseAttendees, trainingByType, DEFAULT_TRAINING_VALID_MONTHS, type TrainingKind } from "./training";

type Tx = Pick<typeof db, "select" | "insert">;

/** Months a training stays valid (setting, default 2 years). */
export async function trainingValidMonths(): Promise<number> {
  const v = Number(await getSetting("trainingValidMonths"));
  return Number.isInteger(v) && v > 0 && v <= 120 ? v : DEFAULT_TRAINING_VALID_MONTHS;
}

/** Active PAMS users who can see this hospital, for the attendee list. */
export async function usersOfFacility(facilityId: number, x: Pick<typeof db, "select"> = db) {
  const limited = x.select({ u: userFacilities.userId }).from(userFacilities).where(eq(userFacilities.facilityId, facilityId));
  return x.select({ id: users.id, name: users.name, jobTitle: users.jobTitle }).from(users)
    .where(and(eq(users.active, true), or(eq(users.allFacilities, true), eq(users.role, "ADMIN"), inArray(users.id, limited))))
    .orderBy(asc(users.name)).limit(400);
}

/**
 * Adds attendees to a session: chosen accounts (their own department when they look after one, else the session's)
 * and typed "Name, Department" lines (department matched to the hospital's, else kept as typed). Skips anyone already
 * on the session. Returns the number added.
 */
export async function addAttendees(tx: Tx, s: { id: number; facilityId: number; departmentId: number | null }, userIds: number[], typed: string | null | undefined): Promise<number> {
  const [deps, existing] = await Promise.all([
    tx.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).where(eq(departments.facilityId, s.facilityId)),
    tx.select({ userId: trainingAttendees.userId, name: trainingAttendees.name }).from(trainingAttendees).where(eq(trainingAttendees.sessionId, s.id)),
  ]);
  const haveUser = new Set(existing.map((e) => e.userId).filter(Boolean));
  const haveName = new Set(existing.map((e) => e.name.toLowerCase().replace(/\s+/g, " ").trim()));
  const rows: (typeof trainingAttendees.$inferInsert)[] = [];
  const allowed = userIds.length ? await usersOfFacility(s.facilityId, tx) : [];
  const chosen = allowed.filter((u) => userIds.includes(u.id) && !haveUser.has(u.id));
  const ownDept = chosen.length ? await tx.select({ userId: userDepartments.userId, departmentId: userDepartments.departmentId }).from(userDepartments)
    .where(inArray(userDepartments.userId, chosen.map((u) => u.id))) : [];
  const depIds = new Set(deps.map((d) => d.id));
  for (const u of chosen) {
    const own = ownDept.find((x) => x.userId === u.id && depIds.has(x.departmentId))?.departmentId;
    rows.push({ sessionId: s.id, userId: u.id, name: u.name, departmentId: own ?? s.departmentId });
  }
  for (const t of parseAttendees(typed)) {
    const k = t.name.toLowerCase();
    if (haveName.has(k)) continue;
    haveName.add(k);
    const dep = matchDepartment(t.departmentText, deps);
    rows.push({ sessionId: s.id, userId: null, name: t.name, departmentId: dep ?? (t.departmentText ? null : s.departmentId), departmentText: dep ? null : t.departmentText });
  }
  if (rows.length) await tx.insert(trainingAttendees).values(rows);
  return rows.length;
}

/** For the department page: who is trained on each of these device types in this department. */
export async function departmentTraining(facilityId: number, departmentId: number, typeIds: number[], today: string) {
  const months = await trainingValidMonths();
  if (!typeIds.length) return { months, byType: [] };
  const rows = await db.select({ deviceTypeId: trainingSessions.deviceTypeId, userId: trainingAttendees.userId, name: trainingAttendees.name, heldOn: trainingSessions.heldOn, kind: trainingSessions.kind })
    .from(trainingAttendees).innerJoin(trainingSessions, eq(trainingSessions.id, trainingAttendees.sessionId))
    .where(and(eq(trainingSessions.facilityId, facilityId), inArray(trainingSessions.deviceTypeId, typeIds),
      sql`coalesce(${trainingAttendees.departmentId}, ${trainingSessions.departmentId}) = ${departmentId}`));
  return { months, byType: trainingByType(typeIds, rows.map((r) => ({ ...r, kind: r.kind as TrainingKind })), months, today) };
}
